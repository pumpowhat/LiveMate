import type { LiveSession, Order, Product } from "@livemate/shared";
import express from "express";
import { z } from "zod";
import type { CommentPipeline } from "../pipeline/pipeline.ts";
import { emitOrderPrivate, type Io } from "../realtime/sink.ts";
import type { RiskEngine } from "../risk/engine.ts";
import type { BackendStore } from "../store/types.ts";
import { parseBody, requireOwnedSession, withSellerAuth } from "./helpers.ts";

const CreateSessionBody = z
  .object({
    roomCode: z.string().trim().min(3).max(24).optional(),
    seedCatalog: z.boolean().optional(),
  })
  .optional();

const ProductBody = z.object({
  code: z.string().trim().min(1, "Mã sản phẩm không được trống").max(20),
  name: z.string().trim().min(1, "Tên sản phẩm không được trống").max(120),
  sizes: z.array(z.string().trim().min(1)).default([]),
  price: z.number().int("Giá phải là số nguyên").nonnegative("Giá không được âm"),
  stock: z.record(z.string(), z.number().int("Tồn kho phải là số nguyên").nonnegative("Tồn kho không được âm")),
});

const PatchProductBody = z
  .object({
    code: z.string().trim().min(1, "Mã sản phẩm không được trống").max(20).optional(),
    name: z.string().trim().min(1, "Tên sản phẩm không được trống").max(120).optional(),
    sizes: z.array(z.string().trim().min(1)).optional(),
    price: z.number().int("Giá phải là số nguyên").nonnegative("Giá không được âm").optional(),
    stock: z.record(z.string(), z.number().int("Tồn kho phải là số nguyên").nonnegative("Tồn kho không được âm")).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Cần ít nhất một trường để cập nhật");

const FeaturedBody = z.object({
  productId: z.string().min(1).nullable(),
});

const PatchOrderItemBody = z.object({
  line: z.object({
    productId: z.string().min(1),
    size: z.string().nullable(),
  }),
  patch: z
    .object({
      productId: z.string().min(1).optional(),
      size: z.string().nullable().optional(),
      qty: z.number().int().positive().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, "Cần ít nhất một thay đổi"),
});

export function createSessionsRouter(deps: {
  store: BackendStore;
  io: Io;
  defaultCatalog: Product[];
  pipeline: CommentPipeline;
  risk: RiskEngine;
  endSession?: (sessionId: string) => Promise<LiveSession>;
  onSessionEnded?: (session: LiveSession) => void;
  onSessionActive?: (session: LiveSession) => void;
}): express.Router {
  const router = express.Router();
  const { store, io } = deps;

  router.get(
    "/sessions",
    withSellerAuth(store, async (_req, res, { seller }) => {
      const sessions = await store.listSessionsBySeller(seller.id);
      res.json({ sessions });
    }),
  );

  router.post(
    "/sessions",
    withSellerAuth(store, async (req, res, { seller }) => {
      const body = parseBody(CreateSessionBody, req.body);
      const session = await store.createSession(seller.id, {
        ...(body?.roomCode ? { roomCode: body.roomCode } : {}),
        ...(body?.seedCatalog ? { seedCatalog: deps.defaultCatalog } : {}),
      });
      deps.onSessionActive?.(session);
      res.status(201).json({ session });
    }),
  );

  router.get(
    "/sessions/:id",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      const session = await requireOwnedSession(store, sessionId, seller.id);
      const [catalog, orders, comments, risks] = await Promise.all([
        store.listProducts(session.id),
        store.listOrdersBySession(session.id),
        store.listComments(session.id),
        store.listRiskAlerts(session.id),
      ]);
      const verdicts = comments
        .filter((c) => c.verdict !== undefined)
        .map((c) => ({
          commentId: c.id,
          verdict: c.verdict!,
          ...(c.verdictOrderId ? { orderId: c.verdictOrderId } : {}),
        }));
      res.json({ session, catalog, orders, comments, verdicts, risks });
    }),
  );

  router.post(
    "/sessions/:id/end",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const session = deps.endSession
        ? await deps.endSession(sessionId)
        : await (async () => {
            await deps.pipeline.drain(sessionId);
            const ended = await store.endSession(sessionId);
            deps.onSessionEnded?.(ended);
            io.to(ended.roomCode).emit("session:updated", ended);
            return ended;
          })();
      res.json({ session });
    }),
  );

  router.get(
    "/sessions/:id/summary",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const summary = await store.getSessionSummary(sessionId);
      res.json(summary);
    }),
  );

  router.post(
    "/sessions/:id/products",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const body = parseBody(ProductBody, req.body ?? {});
      const product = await store.createProduct(sessionId, body);
      res.status(201).json({ product });
    }),
  );

  router.patch(
    "/sessions/:id/products/:productId",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      const productId = String(req.params.productId ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const patch = parseBody(PatchProductBody, req.body ?? {});
      const product = await store.updateProduct(sessionId, productId, patch);
      const currentSession = await store.getSessionById(sessionId);
      if (currentSession?.featuredProductId === product.id) {
        io.to(currentSession.roomCode).emit("product:featured", { sessionId, product });
      }
      res.json({ product });
    }),
  );

  router.delete(
    "/sessions/:id/products/:productId",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      const productId = String(req.params.productId ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const { sessionUpdated } = await store.deleteProduct(sessionId, productId);
      if (sessionUpdated) {
        io.to(sessionUpdated.roomCode).emit("session:updated", sessionUpdated);
        io.to(sessionUpdated.roomCode).emit("product:featured", { sessionId, product: null });
      }
      res.json({ ok: true });
    }),
  );

  router.put(
    "/sessions/:id/featured",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      await requireOwnedSession(store, sessionId, seller.id);
      const { productId } = parseBody(FeaturedBody, req.body ?? {});
      const { session, product } = await store.setFeaturedProduct(sessionId, productId);
      io.to(session.roomCode).emit("session:updated", session);
      io.to(session.roomCode).emit("product:featured", { sessionId: session.id, product });
      res.json({ session });
    }),
  );

  router.patch(
    "/sessions/:id/orders/:orderId",
    withSellerAuth(store, async (req, res, { seller }) => {
      const sessionId = String(req.params.id ?? "");
      const orderId = String(req.params.orderId ?? "");
      const session = await requireOwnedSession(store, sessionId, seller.id);
      const { line, patch } = parseBody(PatchOrderItemBody, req.body ?? {});
      const order: Order = await store.sellerPatchOrderItem(sessionId, orderId, line, patch);
      deps.risk.onOrderChanged(order);
      emitOrderPrivate(io, session.roomCode, "order:updated", order);
      res.json({ order });
    }),
  );

  return router;
}
