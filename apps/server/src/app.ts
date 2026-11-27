import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server } from "socket.io";
import { sellerRoom, type Comment, type LiveSession, type Product } from "@livemate/shared";
import { CommentPoller } from "./facebook/poller.ts";
import { GraphClient } from "./facebook/graph.ts";
import { InMemoryOrderGateway } from "./pipeline/memory-gateway.ts";
import type { LlmClient } from "./pipeline/llm.ts";
import { CommentPipeline, type PipelineSink } from "./pipeline/pipeline.ts";
import { InMemoryBuyerHistoryStore } from "./risk/history.ts";
import { RiskEngine } from "./risk/engine.ts";
import { vietQrPngBuffer } from "./payment/vietqr.ts";
import { createSocketSink, type Io } from "./realtime/sink.ts";

export interface AppConfig {
  llm: LlmClient;
  catalog: Product[];
  webOrigin: string;
  publicWebUrl: string;
  vietqr: { bankBin: string; accountNumber: string } | null;
  facebook: { graphVersion: string; pageToken: string } | null;
  /** Lịch sử boom đơn mẫu cho demo, ví dụ { "u_boom": { boomed: 2, completed: 0 } }. */
  buyerHistorySeed?: Record<string, { boomed: number; completed: number }>;
}

/**
 * Server dev: một phiên DEMO chạy in-memory với danh mục mẫu.
 * Khi lớp Prisma của Nhật (issue #4, #5) xong, thay InMemoryOrderGateway bằng gateway thật.
 */
export function createApp(cfg: AppConfig) {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  const io: Io = new Server(httpServer, { cors: { origin: cfg.webOrigin } });

  const session: LiveSession = {
    id: "s_demo",
    roomCode: "DEMO",
    status: "live",
    featuredProductId: cfg.catalog[0]?.id ?? null,
    facebookObjectId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const gateway = new InMemoryOrderGateway({ session, catalog: cfg.catalog });
  const rooms = new Map([[session.id, session.roomCode]]);
  const sessionByRoom = new Map([[session.roomCode, session.id]]);

  const graph = cfg.facebook ? new GraphClient({ graphVersion: cfg.facebook.graphVersion }) : null;
  const sink = createSocketSink({
    io,
    roomOf: (id) => rooms.get(id),
    orderUrl: (token) => `${cfg.publicWebUrl}/o/${token}`,
    ...(graph && cfg.facebook
      ? { replyOnFacebook: async (_sid: string, fbCommentId: string, text: string) => void (await graph.replyToComment(fbCommentId, text, cfg.facebook!.pageToken)) }
      : {}),
  });
  // Cảnh báo rủi ro: chỉ người bán thấy.
  const risk = new RiskEngine({
    history: new InMemoryBuyerHistoryStore(cfg.buyerHistorySeed ?? {}),
    emit: (alert) => {
      const room = rooms.get(alert.sessionId);
      if (room) io.to(sellerRoom(room)).emit("risk:alert", alert);
    },
  });
  const withRisk: PipelineSink = {
    ...sink,
    onOrder(sessionId, order, created, comment) {
      sink.onOrder(sessionId, order, created, comment);
      if (created) risk.onOrderCreated(order).catch((err) => console.error("[risk]", err));
      risk.onOrderChanged(order);
      risk.onBuyerAction(sessionId, order.buyer.externalId, order.id);
    },
    onReply(sessionId, comment, text, reason, meta) {
      sink.onReply(sessionId, comment, text, reason, meta);
      if (reason === "out_of_stock" && meta) risk.onOutOfStock(sessionId, comment.buyerExternalId, meta.productCode, meta.size);
    },
  };
  const pipeline = new CommentPipeline(cfg.llm, gateway, withRisk);

  /** Mọi nguồn bình luận đi qua đây: phát cho phòng rồi đưa vào pipeline. */
  const ingest = (comment: Comment) => {
    const room = rooms.get(comment.sessionId);
    if (room) io.to(room).emit("comment:new", comment);
    pipeline.push(comment).catch((err) => console.error("[pipeline] push failed", err));
  };

  // ---------- Socket.IO ----------
  io.on("connection", (socket) => {
    socket.on("room:join", ({ roomCode, asSeller }) => {
      if (!sessionByRoom.has(roomCode)) return;
      void socket.join(roomCode);
      // TODO(#3): chỉ người bán đã đăng nhập mới được join seller room.
      if (asSeller) void socket.join(sellerRoom(roomCode));
    });

    socket.on("comment:send", (p) => {
      const sessionId = sessionByRoom.get(p.roomCode);
      const text = p.text?.trim();
      if (!sessionId || !text || text.length > 500) return;
      ingest({
        id: `c_${randomUUID()}`,
        sessionId,
        source: p.source ?? "room",
        buyerExternalId: String(p.buyerExternalId).slice(0, 100),
        buyerName: String(p.buyerName).slice(0, 60) || "Khách",
        text,
        createdAt: new Date().toISOString(),
      });
    });
  });

  // ---------- HTTP ----------
  app.get("/health", (_req, res) => {
    res.json({ ok: true, llm: cfg.llm.name, facebook: Boolean(cfg.facebook), vietqr: Boolean(cfg.vietqr) });
  });

  /** Ảnh QR VietQR của đơn — trang đơn công khai /o/<token> nhúng ảnh này. */
  app.get("/api/orders/:token/qr.png", async (req, res) => {
    if (!cfg.vietqr) return void res.status(503).json({ error: "Chưa cấu hình VIETQR_ACCOUNT_NUMBER" });
    const order = gateway.listOrders().find((o) => o.publicToken === req.params.token);
    if (!order || order.status === "cancelled") return void res.status(404).json({ error: "Không tìm thấy đơn" });
    const png = await vietQrPngBuffer({ ...cfg.vietqr, amount: order.total, addInfo: `LM ${order.code}` });
    res.type("png").set("Cache-Control", "no-store").send(png);
  });

  // Dev: xem nhanh trạng thái phiên DEMO.
  app.get("/api/dev/state", (_req, res) => {
    res.json({ session, catalog: cfg.catalog, orders: gateway.listOrders() });
  });

  app.post("/api/dev/featured", (req, res) => {
    const code = String(req.body?.code ?? "");
    const p = cfg.catalog.find((x) => x.code === code);
    if (!p) return void res.status(404).json({ error: "Không có mã này" });
    gateway.setFeatured(code);
    session.featuredProductId = p.id;
    io.to(session.roomCode).emit("session:updated", session);
    res.json(session);
  });

  // Dev: theo dõi bình luận một live video / bài đăng của Fanpage (dùng FB_PAGE_TOKEN).
  let poller: CommentPoller | null = null;
  app.post("/api/dev/facebook/watch", (req, res) => {
    if (!graph || !cfg.facebook) return void res.status(503).json({ error: "Chưa cấu hình FB_GRAPH_VERSION / FB_PAGE_TOKEN" });
    const objectId = String(req.body?.objectId ?? "");
    if (!/^[\d_]+$/.test(objectId)) return void res.status(400).json({ error: "objectId không hợp lệ" });
    poller?.stop();
    poller = new CommentPoller({
      client: graph,
      objectId,
      pageToken: cfg.facebook.pageToken,
      sessionId: session.id,
      onComment: ingest,
      onError: (e) => console.error("[facebook] poller stopped", e),
    });
    poller.start();
    session.facebookObjectId = objectId;
    io.to(session.roomCode).emit("session:updated", session);
    res.json({ watching: objectId });
  });

  app.post("/api/dev/facebook/stop", (_req, res) => {
    poller?.stop();
    poller = null;
    session.facebookObjectId = null;
    res.json({ watching: null });
  });

  // TODO(#5): khi API đơn hàng của Nhật xử lý "Đã chuyển" / xác nhận, gọi
  // risk.onPaymentReported(order) / risk.onPaymentConfirmed(order.id) / risk.onOrderClosed(order, outcome).
  return { app, httpServer, io, pipeline, gateway, session, risk };
}
