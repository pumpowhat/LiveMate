import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { Server } from "socket.io";
import {
  buyerRoom,
  orderRoom,
  sellerRoom,
  type ClientToServerEvents,
  type Comment,
  type LiveSession,
  type Product,
  type Seller,
  type ServerToClientEvents,
} from "@livemate/shared";
import { verifySocketToken } from "./auth/crypto.ts";
import { CommentPoller } from "./facebook/poller.ts";
import { GraphClient } from "./facebook/graph.ts";
import { createFacebookRouter } from "./facebook/routes.ts";
import type { LlmClient } from "./pipeline/llm.ts";
import { CommentPipeline, type BatchMetrics, type PipelineSink } from "./pipeline/pipeline.ts";
import { RiskEngine } from "./risk/engine.ts";
import { createSocketSink, emitOrderPrivate, type Io } from "./realtime/sink.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { requireOwnedSession, resolveAuthenticatedSeller } from "./routes/helpers.ts";
import { createOrdersRouter } from "./routes/orders.ts";
import { createRoomsRouter } from "./routes/rooms.ts";
import { createSessionsRouter } from "./routes/sessions.ts";
import { AppError, ConflictError } from "./store/errors.ts";
import { MemoryBackendStore } from "./store/memory-store.ts";
import { toPublicComment } from "./store/transitions.ts";
import type { BackendStore } from "./store/types.ts";

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
   * Bật /api/dev/*, cho phép /api/ingest không cần key, luồng DEMO cũ và seller "demo" cho Kết nối Fanpage.
   * CHỈ dùng khi chạy local. index.ts bật khi NODE_ENV !== "production" (hoặc DEV_ROUTES=1).
   */
  devRoutes?: boolean;
  /** Gom lô: cửa sổ (ms) và số bình luận tối đa mỗi lần gọi LLM. */
  pipeline?: { batchWindowMs?: number; maxBatchSize?: number };
  /** Store backend (Prisma hoặc Memory). Mặc định khởi tạo MemoryBackendStore. */
  store?: BackendStore;
  /** Kết quả seed DEMO nếu đã chạy sẵn trước khi gọi createApp. */
  demoSeed?: { seller: Seller; session: LiveSession };
  /** Bí mật ký socket-token ngắn hạn (nên đặt AUTH_SECRET ở production). */
  authSecret?: string;
}

interface SocketData {
  sellerId: string | null;
  authSessionId?: string;
  buyerAuth: Map<string, { sessionId: string; buyerExternalId: string; displayName: string }>;
}

const authSessionRoom = (id: string) => `auth-session:${id}`;

export function createApp(cfg: AppConfig) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    if (req.method === "GET") res.set("Cache-Control", "no-store");
    next();
  });
  // Route dev không có xác thực: tắt hẳn khi deploy.
  app.use("/api/dev", (_req, res, next) => (cfg.devRoutes ? next() : void res.status(404).json({ error: "Không có route này" })));

  const httpServer = createServer(app);
  const io: Io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: cfg.webOrigin },
  });

  const store: BackendStore = cfg.store ?? new MemoryBackendStore({ buyerHistorySeed: cfg.buyerHistorySeed });
  const authSecret = cfg.authSecret ?? (process.env.AUTH_SECRET || randomBytes(32).toString("hex"));

  const rooms = new Map<string, string>();
  const rememberSession = (s: LiveSession) => {
    rooms.set(s.id, s.roomCode);
  };

  let demoSellerId = cfg.demoSeed?.seller.id ?? "seller_demo";
  let demoSession: LiveSession = cfg.demoSeed?.session ?? {
    id: "s_demo",
    roomCode: "DEMO",
    sellerId: demoSellerId,
    status: "live",
    featuredProductId: cfg.catalog[0]?.id ?? null,
    facebookObjectId: null,
    facebookPageId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  rememberSession(demoSession);

  const ready: Promise<void> = cfg.demoSeed
    ? Promise.resolve()
    : store.ensureDemoSeed(cfg.catalog).then((seeded) => {
        demoSellerId = seeded.seller.id;
        demoSession = seeded.session;
        rememberSession(seeded.session);
      });

  const graph = cfg.facebook ? new GraphClient({ graphVersion: cfg.facebook.graphVersion }) : null;
  const pollers = new Map<string, { poller: CommentPoller; sellerId: string; pageToken: string }>();

  const stopSessionPoller = (sessionId: string) => {
    const entry = pollers.get(sessionId);
    if (!entry) return;
    entry.poller.stop();
    pollers.delete(sessionId);
  };

  const stopSellerPollers = (sellerId: string) => {
    for (const [sid, entry] of pollers) {
      if (entry.sellerId === sellerId) {
        entry.poller.stop();
        pollers.delete(sid);
      }
    }
  };

  const resolvePageTokenForSession = async (sessionId: string): Promise<string | null> => {
    const active = pollers.get(sessionId);
    if (active) return active.pageToken;
    const session = await store.getSessionById(sessionId);
    if (!session) return null;
    if (session.sellerId) {
      const page = await store.facebookStore.selectedPage(session.sellerId);
      if (page?.accessToken) return page.accessToken;
    }
    if (session.id === demoSession.id && cfg.facebook?.pageToken) {
      return cfg.facebook.pageToken;
    }
    return null;
  };

  const replyOnFacebook = graph
    ? async (sessionId: string, fbCommentId: string, text: string) => {
        const token = await resolvePageTokenForSession(sessionId);
        if (!token) return;
        await graph.replyToComment(fbCommentId, text, token);
      }
    : undefined;

  const orderUrl = (token: string) => `${cfg.publicWebUrl.replace(/\/+$/, "")}/o/${token}`;

  const sink = createSocketSink({
    io,
    roomOf: (id) => rooms.get(id),
    isLegacyPublicDemo: (id) => Boolean(cfg.devRoutes && id === demoSession.id),
    orderUrl,
    ...(replyOnFacebook ? { replyOnFacebook } : {}),
  });

  // Cảnh báo rủi ro: chỉ người bán thấy.
  const risk = new RiskEngine({
    history: store.buyerHistory,
    emit: (alert) => {
      void store.saveRiskAlert(alert).catch((err) => console.error("[risk] save failed", err));
      const room = rooms.get(alert.sessionId);
      if (room) io.to(sellerRoom(room)).emit("risk:alert", alert);
    },
  });

  const batches: BatchMetrics[] = [];
  const withRisk: PipelineSink = {
    ...sink,
    onVerdict(sessionId, commentId, verdict, orderId) {
      sink.onVerdict(sessionId, commentId, verdict, orderId);
      void store.updateCommentVerdict(commentId, verdict, orderId).catch((err) => console.error("[comment] verdict failed", err));
    },
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
    onBatch(_sid, m) {
      batches.push(m);
      if (batches.length > 1000) batches.shift();
    },
  };

  const pipeline = new CommentPipeline(cfg.llm, store.gateway, withRisk, cfg.pipeline ?? {});

  const inFlightIngests = new Map<string, Set<Promise<void>>>();
  const endingSessions = new Set<string>();
  const endingPromises = new Map<string, Promise<LiveSession>>();

  /** Mọi nguồn bình luận đi qua đây: lưu DB, phát theo quyền rồi đưa vào pipeline. */
  const ingest = (comment: Comment): boolean => {
    if (endingSessions.has(comment.sessionId)) return false;

    let set = inFlightIngests.get(comment.sessionId);
    if (!set) {
      set = new Set();
      inFlightIngests.set(comment.sessionId, set);
    }

    const task: Promise<void> = (async () => {
      try {
        await ready;
        const current = await store.getSessionById(comment.sessionId);
        if (current?.status === "ended") return;
        await store.saveComment(comment);
        const room = rooms.get(comment.sessionId);
        if (room) {
          io.to(sellerRoom(room)).emit("comment:new", comment);
          io.to(room).except(sellerRoom(room)).emit("comment:new", toPublicComment(comment));
        }
        await pipeline.push(comment).catch((err) => console.error("[pipeline] push failed", err));
      } catch (err) {
        console.error("[comment] save failed", err);
      }
    })();

    set.add(task);
    const release = () => {
      set.delete(task);
      if (set.size === 0) inFlightIngests.delete(comment.sessionId);
    };
    void task.then(release, release);
    return true;
  };

  const endLive = (sessionId: string): Promise<LiveSession> => {
    const existing = endingPromises.get(sessionId);
    if (existing) return existing;

    const promise = (async () => {
      endingSessions.add(sessionId);
      stopSessionPoller(sessionId);
      try {
        while (true) {
          const pending = inFlightIngests.get(sessionId);
          if (!pending || pending.size === 0) break;
          await Promise.all([...pending]);
        }
        await pipeline.drain(sessionId);
        const ended = await store.endSession(sessionId);
        rememberSession(ended);
        io.to(ended.roomCode).emit("session:updated", ended);
        return ended;
      } finally {
        endingSessions.delete(sessionId);
        endingPromises.delete(sessionId);
      }
    })();

    endingPromises.set(sessionId, promise);
    return promise;
  };

  const watchFacebook = async (args: {
    sessionId: string;
    sellerId: string;
    pageToken: string;
    objectId: string;
    pageId: string | null;
  }) => {
    if (!graph) throw new Error("Chưa cấu hình FB_GRAPH_VERSION");
    stopSessionPoller(args.sessionId);
    const poller = new CommentPoller({
      client: graph,
      objectId: args.objectId,
      pageToken: args.pageToken,
      sessionId: args.sessionId,
      onComment: (comment) => {
        ingest(comment);
      },
      onError: (e) => console.error("[facebook] poller stopped", e),
    });
    poller.start();
    pollers.set(args.sessionId, { poller, sellerId: args.sellerId, pageToken: args.pageToken });
    const updated = await store.updateSessionFacebook(args.sessionId, args.objectId, args.pageId);
    rememberSession(updated);
    io.to(updated.roomCode).emit("session:updated", updated);
    return updated;
  };

  // ---------- Socket.IO ----------
  io.use(async (socket, next) => {
    try {
      await ready;
      const data = socket.data as SocketData;
      data.sellerId = null;
      data.buyerAuth = new Map();

      const authToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (authToken !== undefined && authToken !== null && authToken !== "") {
        if (typeof authToken !== "string") return next(new Error("Unauthorized"));
        const payload = verifySocketToken(authToken, authSecret);
        if (!payload) return next(new Error("Unauthorized"));
        const auth = await store.findAuthSessionById(payload.sid);
        if (!auth || auth.seller.id !== payload.sellerId) return next(new Error("Unauthorized"));
        data.sellerId = auth.seller.id;
        data.authSessionId = auth.session.id;
      }
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    if (data.authSessionId) void socket.join(authSessionRoom(data.authSessionId));

    socket.on("room:join", async (p, ack) => {
      try {
        await ready;
        const roomCode = typeof p?.roomCode === "string" ? p.roomCode.trim() : "";
        if (!roomCode) {
          ack?.({ ok: false, error: "Thiếu mã phòng" });
          return;
        }
        const session = await store.getSessionByRoomCode(roomCode);
        if (!session) {
          ack?.({ ok: false, error: "Không tìm thấy phòng live" });
          return;
        }
        rememberSession(session);

        if (p.asSeller) {
          const isOwner = Boolean(data.sellerId && session.sellerId === data.sellerId);
          const isLegacyDemoSeller = Boolean(cfg.devRoutes && session.roomCode === "DEMO" && !data.sellerId);
          if (!isOwner && !isLegacyDemoSeller) {
            ack?.({ ok: false, error: "Không có quyền truy cập phòng người bán" });
            return;
          }
          await socket.join(sellerRoom(session.roomCode));
        }

        if (p.buyerToken !== undefined) {
          if (typeof p.buyerToken !== "string" || !p.buyerToken.trim()) {
            ack?.({ ok: false, error: "Phiên người mua không hợp lệ" });
            return;
          }
          const cap = await store.resolveBuyerCapability(session.id, p.buyerToken.trim());
          if (!cap) {
            ack?.({ ok: false, error: "Phiên người mua không hợp lệ" });
            return;
          }
          data.buyerAuth.set(session.roomCode, {
            sessionId: session.id,
            buyerExternalId: cap.buyerExternalId,
            displayName: cap.displayName,
          });
          await socket.join(buyerRoom(session.id, cap.buyerExternalId));
        }

        await socket.join(session.roomCode);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "Không thể tham gia phòng" });
      }
    });

    socket.on("order:join", async (p, ack) => {
      try {
        await ready;
        const publicToken = typeof p?.publicToken === "string" ? p.publicToken.trim() : "";
        if (!publicToken) {
          ack?.({ ok: false, error: "Thiếu mã đơn hàng" });
          return;
        }
        const order = await store.getOrderByPublicToken(publicToken);
        if (!order) {
          ack?.({ ok: false, error: "Không tìm thấy đơn hàng" });
          return;
        }
        await socket.join(orderRoom(order.publicToken));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "Không thể theo dõi đơn hàng" });
      }
    });

    socket.on("comment:send", async (p, ack) => {
      try {
        await ready;
        const roomCode = typeof p?.roomCode === "string" ? p.roomCode.trim() : "";
        const text = typeof p?.text === "string" ? p.text.trim() : "";
        if (!roomCode || !text || text.length > 500) {
          ack?.({ ok: false, error: "Nội dung bình luận không hợp lệ" });
          return;
        }
        const session = await store.getSessionByRoomCode(roomCode);
        if (!session) {
          ack?.({ ok: false, error: "Không tìm thấy phòng live" });
          return;
        }
        if (session.status === "ended") {
          ack?.({ ok: false, error: "Phiên live đã kết thúc" });
          return;
        }
        rememberSession(session);

        let buyerExternalId: string | null = null;
        let buyerName: string | null = null;

        const joinedBuyer = data.buyerAuth.get(session.roomCode);
        if (joinedBuyer) {
          buyerExternalId = joinedBuyer.buyerExternalId;
          buyerName = joinedBuyer.displayName;
        } else if (typeof p.buyerToken === "string" && p.buyerToken.trim()) {
          const cap = await store.resolveBuyerCapability(session.id, p.buyerToken.trim());
          if (cap) {
            buyerExternalId = cap.buyerExternalId;
            buyerName = cap.displayName;
          }
        } else if (cfg.devRoutes && session.roomCode === "DEMO" && typeof p.buyerExternalId === "string" && p.buyerExternalId.trim()) {
          buyerExternalId = p.buyerExternalId.trim().slice(0, 100);
          buyerName = (typeof p.buyerName === "string" ? p.buyerName.trim() : "").slice(0, 60) || "Khách";
        }

        if (!buyerExternalId || !buyerName) {
          ack?.({ ok: false, error: "Vui lòng tham gia phòng trước khi bình luận" });
          return;
        }

        const admitted = ingest({
          id: `c_${randomUUID()}`,
          sessionId: session.id,
          source: p.source === "extension" ? "extension" : "room",
          buyerExternalId,
          buyerName,
          text,
          createdAt: new Date().toISOString(),
        });
        if (!admitted) {
          ack?.({ ok: false, error: "Phiên live đã kết thúc" });
          return;
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "Không thể gửi bình luận" });
      }
    });

    socket.on("payment:report", async (p, ack) => {
      try {
        await ready;
        const publicToken = typeof p?.publicToken === "string" ? p.publicToken.trim() : "";
        if (!publicToken) {
          ack?.({ ok: false, error: "Thiếu mã đơn hàng" });
          return;
        }
        const { order, session, changed } = await store.transitionOrderByPublicToken(publicToken, "report_payment");
        rememberSession(session);
        if (changed) {
          risk.onPaymentReported(order);
          emitOrderPrivate(io, session.roomCode, "order:updated", order);
          emitOrderPrivate(io, session.roomCode, "payment:reported", order);
        }
        ack?.({ ok: true });
      } catch (err) {
        const message = err instanceof AppError ? err.message : "Không thể báo thanh toán";
        ack?.({ ok: false, error: message });
      }
    });
  });

  // ---------- HTTP ----------

  // Ensure demo seed completes before handling HTTP requests.
  app.use("/api", (_req, _res, next) => {
    void ready.then(() => next(), next);
  });

  app.use("/api", createAuthRouter({
    store,
    authSecret,
    onLogout: (id) => io.in(authSessionRoom(id)).disconnectSockets(true),
  }));
  app.use(
    "/api",
    createSessionsRouter({
      store,
      io,
      defaultCatalog: cfg.catalog,
      pipeline,
      risk,
      endSession: endLive,
      onSessionActive: rememberSession,
    }),
  );
  app.use(
    "/api",
    createOrdersRouter({
      store,
      io,
      risk,
      vietqr: cfg.vietqr,
      orderUrl,
      ...(replyOnFacebook ? { replyOnFacebook } : {}),
    }),
  );
  app.use("/api", createRoomsRouter({ store }));

  /**
   * Bình luận từ extension đọc live thật (TikTok / Facebook trên Chrome).
   * Bảo vệ bằng header X-Ingest-Key khi cấu hình INGEST_KEY.
   */
  const recentIngest = new Map<string, number>();
  const INGEST_DEDUPE_MS = 10 * 60_000;
  const INGEST_DEDUPE_MAX = 20_000;
  app.use("/api/ingest", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Ingest-Key");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  app.post("/api/ingest", async (req, res, next) => {
    try {
      if (!cfg.ingestKey && !cfg.devRoutes) return void res.status(503).json({ error: "Chưa cấu hình INGEST_KEY trên server" });
      if (cfg.ingestKey && req.get("X-Ingest-Key") !== cfg.ingestKey) return void res.status(401).json({ error: "Sai ingest key" });
      const body = req.body as { roomCode?: unknown; platform?: unknown; comments?: unknown };
      const session = await store.getSessionByRoomCode(String(body?.roomCode ?? ""));
      if (!session) return void res.status(404).json({ error: "Không có phòng này" });
      if (session.status === "ended" || endingSessions.has(session.id)) {
        return void res.status(409).json({ error: "Phiên live đã kết thúc" });
      }
      rememberSession(session);
      if (!Array.isArray(body.comments) || body.comments.length > 100) {
        return void res.status(400).json({ error: "comments phải là mảng tối đa 100 phần tử" });
      }
      const platform = String(body.platform ?? "live").replace(/[^\w-]/g, "").slice(0, 20) || "live";

      const now = Date.now();
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
        const buyerExternalId = `${platform}:${String(raw?.buyerExternalId ?? name).slice(0, 100)}`;
        const sourceKey = raw?.externalId ? `id:${String(raw.externalId)}` : `${buyerExternalId}|${text}`;
        const key = `${session.id}:${platform}:${sourceKey}`;
        if (recentIngest.has(key)) {
          duplicates++;
          continue;
        }
        recentIngest.set(key, now);
        accepted++;
        ingest({
          id: `x_${randomUUID()}`,
          sessionId: session.id,
          source: "extension",
          ...(raw?.externalId ? { externalId: String(raw.externalId).slice(0, 100) } : {}),
          buyerExternalId,
          buyerName: name,
          text,
          createdAt: new Date().toISOString(),
        });
      }
      res.json({ accepted, duplicates });
    } catch (err) {
      next(err);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, llm: cfg.llm.name, facebook: Boolean(cfg.facebook), vietqr: Boolean(cfg.vietqr) });
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

  app.get("/api/dev/state", async (_req, res, next) => {
    try {
      const [current, catalog, orders] = await Promise.all([
        store.getSessionById(demoSession.id),
        store.listProducts(demoSession.id),
        store.listOrdersBySession(demoSession.id),
      ]);
      res.json({ session: current ?? demoSession, catalog, orders });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/dev/featured", async (req, res, next) => {
    try {
      const code = String(req.body?.code ?? "");
      const { session: updated, product } = await store.setFeaturedProductByCode(demoSession.id, code);
      rememberSession(updated);
      io.to(updated.roomCode).emit("session:updated", updated);
      io.to(updated.roomCode).emit("product:featured", { sessionId: updated.id, product });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Luồng thật: /api/facebook/login -> callback -> chọn Fanpage -> /api/facebook/watch.
  if (graph && cfg.facebook?.app) {
    app.use(
      "/api",
      createFacebookRouter({
        graph,
        oauth: { ...cfg.facebook.app, graphVersion: cfg.facebook.graphVersion },
        store: store.facebookStore,
        publicWebUrl: cfg.publicWebUrl,
        resolveSellerId: async (req) => {
          const auth = await resolveAuthenticatedSeller(req, store);
          if (auth) return auth.seller.id;
          return cfg.devRoutes ? demoSellerId : null;
        },
        onWatch: async ({ sellerId, pageToken, objectId, sessionId }) => {
          const target = sessionId
            ? await requireOwnedSession(store, sessionId, sellerId)
            : await store.findActiveSessionForSeller(sellerId);
          if (!target) {
            throw new ConflictError("Vui lòng tạo hoặc chọn phiên live trước.");
          }
          if (target.status === "ended") {
            throw new ConflictError("Phiên live đã kết thúc.");
          }
          const page = await store.facebookStore.selectedPage(sellerId);
          await watchFacebook({
            sessionId: target.id,
            sellerId,
            pageToken,
            objectId,
            pageId: page?.id ?? null,
          });
        },
        onDisconnect: (sellerId) => stopSellerPollers(sellerId),
      }),
    );
  }

  // Dev: theo dõi bằng FB_PAGE_TOKEN trong .env (không qua đăng nhập).
  app.post("/api/dev/facebook/watch", async (req, res, next) => {
    try {
      if (!graph || !cfg.facebook?.pageToken) {
        return void res.status(503).json({ error: "Chưa cấu hình FB_GRAPH_VERSION / FB_PAGE_TOKEN" });
      }
      const objectId = String(req.body?.objectId ?? "");
      if (!/^[\d_]+$/.test(objectId)) return void res.status(400).json({ error: "objectId không hợp lệ" });
      await watchFacebook({
        sessionId: demoSession.id,
        sellerId: demoSellerId,
        pageToken: cfg.facebook.pageToken,
        objectId,
        pageId: null,
      });
      res.json({ watching: objectId });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/dev/facebook/stop", async (_req, res, next) => {
    try {
      stopSessionPoller(demoSession.id);
      await store.updateSessionFacebook(demoSession.id, null, null);
      res.json({ watching: null });
    } catch (err) {
      next(err);
    }
  });

  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && "status" in err && typeof err.status === "number" && [400, 413, 415].includes(err.status)) {
      res.status(err.status).json({ error: "Dữ liệu yêu cầu không hợp lệ." });
      return;
    }
    console.error("[server]", err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  };
  app.use(errorHandler);

  return { app, httpServer, io, pipeline, gateway: store.gateway, session: demoSession, risk, store, ready };
}
