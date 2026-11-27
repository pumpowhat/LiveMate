import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server } from "socket.io";
import { sellerRoom, type Comment, type LiveSession, type Product } from "@livemate/shared";
import { CommentPoller } from "./facebook/poller.ts";
import { GraphClient } from "./facebook/graph.ts";
import { createFacebookRouter } from "./facebook/routes.ts";
import { InMemoryFacebookConnectionStore } from "./facebook/store.ts";
import { InMemoryOrderGateway } from "./pipeline/memory-gateway.ts";
import type { LlmClient } from "./pipeline/llm.ts";
import { CommentPipeline, type BatchMetrics, type PipelineSink } from "./pipeline/pipeline.ts";
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
  /**
   * Facebook. `pageToken` (FB_PAGE_TOKEN) dùng cho dev/spike; `app` bật luồng "Kết nối Fanpage".
   * Cần ít nhất graphVersion.
   */
  facebook: {
    graphVersion: string;
    pageToken?: string;
    app?: { appId: string; appSecret: string; redirectUri: string };
  } | null;
  /** Lịch sử boom đơn mẫu cho demo, ví dụ { "u_boom": { boomed: 2, completed: 0 } }. */
  buyerHistorySeed?: Record<string, { boomed: number; completed: number }>;
  /** Khóa cho POST /api/ingest (extension). Bỏ trống = không kiểm tra (chỉ dùng khi dev). */
  ingestKey?: string;
  /**
   * Bật /api/dev/*, cho phép /api/ingest không cần key và seller "demo" cho Kết nối Fanpage.
   * CHỈ dùng khi chạy local. index.ts bật khi NODE_ENV !== "production" (hoặc DEV_ROUTES=1).
   */
  devRoutes?: boolean;
  /** Gom lô: cửa sổ (ms) và số bình luận tối đa mỗi lần gọi LLM. */
  pipeline?: { batchWindowMs?: number; maxBatchSize?: number };
}

/**
 * Server dev: một phiên DEMO chạy in-memory với danh mục mẫu.
 * Khi lớp Prisma của Nhật (issue #4, #5) xong, thay InMemoryOrderGateway bằng gateway thật.
 */
export function createApp(cfg: AppConfig) {
  const app = express();
  app.use(express.json());
  // Route dev không có xác thực: tắt hẳn khi deploy.
  app.use("/api/dev", (_req, res, next) => (cfg.devRoutes ? next() : void res.status(404).json({ error: "Không có route này" })));
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
  // Token Fanpage đang dùng: từ "Kết nối Fanpage" (ưu tiên) hoặc FB_PAGE_TOKEN.
  let activePageToken: string | null = cfg.facebook?.pageToken ?? null;
  const sink = createSocketSink({
    io,
    roomOf: (id) => rooms.get(id),
    orderUrl: (token) => `${cfg.publicWebUrl}/o/${token}`,
    ...(graph
      ? {
          replyOnFacebook: async (_sid: string, fbCommentId: string, text: string) => {
            if (!activePageToken) return;
            await graph.replyToComment(fbCommentId, text, activePageToken);
          },
        }
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
  // Số liệu lô gần nhất (cho /api/dev/metrics và load test).
  const batches: BatchMetrics[] = [];
  withRisk.onBatch = (_sid, m) => {
    batches.push(m);
    if (batches.length > 1000) batches.shift();
  };
  const pipeline = new CommentPipeline(cfg.llm, gateway, withRisk, cfg.pipeline ?? {});

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

  /**
   * Bình luận từ extension đọc live thật (TikTok / Facebook trên Chrome).
   * Bảo vệ bằng header X-Ingest-Key khi cấu hình INGEST_KEY. Chống trùng vì
   * extension có thể đọc lại cùng một bình luận khi trang render lại.
   */
  const recentIngest = new Map<string, number>(); // key -> thời điểm (ms)
  // 10 phút: TikTok/Facebook vẽ lại các dòng chat cũ khi cuộn, extension sẽ đọc lại —
  // cửa sổ ngắn sẽ biến bình luận cũ thành đơn trùng.
  const INGEST_DEDUPE_MS = 10 * 60_000;
  const INGEST_DEDUPE_MAX = 20_000;
  app.use("/api/ingest", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Ingest-Key");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  app.post("/api/ingest", (req, res) => {
    if (!cfg.ingestKey && !cfg.devRoutes) return void res.status(503).json({ error: "Chưa cấu hình INGEST_KEY trên server" });
    if (cfg.ingestKey && req.get("X-Ingest-Key") !== cfg.ingestKey) return void res.status(401).json({ error: "Sai ingest key" });
    const body = req.body as { roomCode?: unknown; platform?: unknown; comments?: unknown };
    const sessionId = sessionByRoom.get(String(body?.roomCode ?? ""));
    if (!sessionId) return void res.status(404).json({ error: "Không có phòng này" });
    if (!Array.isArray(body.comments) || body.comments.length > 100) return void res.status(400).json({ error: "comments phải là mảng tối đa 100 phần tử" });
    const platform = String(body.platform ?? "live").replace(/[^\w-]/g, "").slice(0, 20) || "live";

    const now = Date.now();
    // Map giữ thứ tự chèn: xóa từ đầu cho tới khi gặp mục còn hạn, và giới hạn kích thước.
    for (const [k, t] of recentIngest) {
      if (now - t <= INGEST_DEDUPE_MS && recentIngest.size <= INGEST_DEDUPE_MAX) break;
      recentIngest.delete(k);
    }

    let accepted = 0;
    let duplicates = 0;
    for (const raw of body.comments as Record<string, unknown>[]) {
      const name = String(raw?.buyerName ?? "").trim().slice(0, 60);
      const text = String(raw?.text ?? "").trim().slice(0, 500);
      if (!name || !text) continue;
      // Không có id ổn định từ DOM: dùng tên hiển thị làm id người mua, theo từng nền tảng.
      const buyerExternalId = `${platform}:${String(raw?.buyerExternalId ?? name).slice(0, 100)}`;
      const key = raw?.externalId ? `id:${String(raw.externalId)}` : `${buyerExternalId}|${text}`;
      if (recentIngest.has(key)) {
        duplicates++;
        continue;
      }
      recentIngest.set(key, now);
      accepted++;
      ingest({
        id: `x_${randomUUID()}`,
        sessionId,
        source: "extension",
        ...(raw?.externalId ? { externalId: String(raw.externalId).slice(0, 100) } : {}),
        buyerExternalId,
        buyerName: name,
        text,
        createdAt: new Date().toISOString(),
      });
    }
    res.json({ accepted, duplicates });
  });

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
  app.get("/api/dev/metrics", (_req, res) => {
    const pct = (xs: number[], p: number) => {
      if (!xs.length) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!);
    };
    const sizes = batches.map((b) => b.size);
    res.json({
      llm: cfg.llm.name,
      batches: batches.length,
      comments: sizes.reduce((a, b) => a + b, 0),
      failedBatches: batches.filter((b) => !b.ok).length,
      batchSize: { avg: sizes.length ? +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2) : 0, max: Math.max(0, ...sizes) },
      llmMs: { p50: pct(batches.map((b) => b.llmMs), 50), p95: pct(batches.map((b) => b.llmMs), 95) },
      waitMs: { p50: pct(batches.map((b) => b.oldestWaitMs), 50), p95: pct(batches.map((b) => b.oldestWaitMs), 95) },
    });
  });

  app.post("/api/dev/metrics/reset", (_req, res) => {
    batches.length = 0;
    res.json({ ok: true });
  });

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
  const watchFacebook = (pageToken: string, objectId: string) => {
    if (!graph) throw new Error("Chưa cấu hình FB_GRAPH_VERSION");
    poller?.stop();
    activePageToken = pageToken;
    poller = new CommentPoller({
      client: graph,
      objectId,
      pageToken,
      sessionId: session.id,
      onComment: ingest,
      onError: (e) => console.error("[facebook] poller stopped", e),
    });
    poller.start();
    session.facebookObjectId = objectId;
    io.to(session.roomCode).emit("session:updated", session);
  };

  // Luồng thật: /api/facebook/login -> callback -> chọn Fanpage -> /api/facebook/watch.
  if (graph && cfg.facebook?.app) {
    app.use(
      "/api",
      createFacebookRouter({
        graph,
        oauth: { ...cfg.facebook.app, graphVersion: cfg.facebook.graphVersion },
        store: new InMemoryFacebookConnectionStore(),
        publicWebUrl: cfg.publicWebUrl,
        // TODO(#3): lấy sellerId từ phiên đăng nhập. Tới lúc đó, khi deploy (không phải dev)
        // trả null => 401, để người lạ không ngắt kết nối / đổi video đang theo dõi.
        resolveSellerId: () => (cfg.devRoutes ? "demo" : null),
        onWatch: ({ pageToken, objectId }) => watchFacebook(pageToken, objectId),
      }),
    );
  }

  // Dev: theo dõi bằng FB_PAGE_TOKEN trong .env (không qua đăng nhập).
  app.post("/api/dev/facebook/watch", (req, res) => {
    if (!graph || !cfg.facebook?.pageToken) return void res.status(503).json({ error: "Chưa cấu hình FB_GRAPH_VERSION / FB_PAGE_TOKEN" });
    const objectId = String(req.body?.objectId ?? "");
    if (!/^[\d_]+$/.test(objectId)) return void res.status(400).json({ error: "objectId không hợp lệ" });
    watchFacebook(cfg.facebook.pageToken, objectId);
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
