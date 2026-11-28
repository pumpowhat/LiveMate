import { buyerRoom, sellerRoom } from "@livemate/shared";
import express from "express";
import { z } from "zod";
import { paymentReference, toPublicOrder } from "../payment/public-order.ts";
import { vietQrPngBuffer } from "../payment/vietqr.ts";
import { emitOrderPrivate, type Io } from "../realtime/sink.ts";
import type { RiskEngine } from "../risk/engine.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../store/errors.ts";
import type { BackendStore } from "../store/types.ts";
import { parseBody, withSellerAuth } from "./helpers.ts";

const PaymentBody = z.object({ updatedAt: z.iso.datetime() });

export function createOrdersRouter(deps: {
  store: BackendStore;
  io: Io;
  risk: RiskEngine;
  vietqr: { bankBin: string; accountNumber: string } | null;
  orderUrl: (publicToken: string) => string;
  replyOnFacebook?: (sessionId: string, fbCommentId: string, text: string) => Promise<void>;
}): express.Router {
  const router = express.Router();
  const { store, io, risk } = deps;

  async function requireOwnedOrder(orderId: string, sellerId: string) {
    const order = await store.getOrderById(orderId);
    if (!order) throw new NotFoundError("Không tìm thấy đơn hàng");
    const session = await store.getSessionById(order.sessionId);
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    if (session.sellerId !== sellerId) {
      throw new ForbiddenError("Bạn không có quyền thao tác trên đơn hàng này");
    }
    return { order, session };
  }

  async function requirePublicOrder(token: string) {
    const order = await store.getOrderByPublicToken(token);
    if (!order) throw new NotFoundError("Không tìm thấy đơn hàng");
    const session = await store.getSessionById(order.sessionId);
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    return { order, roomCode: session.roomCode };
  }

  router.post(
    "/orders/:orderId/approve",
    withSellerAuth(store, async (req, res, { seller }) => {
      const orderId = String(req.params.orderId ?? "");
      await requireOwnedOrder(orderId, seller.id);
      const { order, session } = await store.transitionOrderById(orderId, "approve");
      emitOrderPrivate(io, session.roomCode, "order:updated", order);
      res.json({ order });
    }),
  );

  router.post(
    "/orders/:orderId/cancel",
    withSellerAuth(store, async (req, res, { seller }) => {
      const orderId = String(req.params.orderId ?? "");
      await requireOwnedOrder(orderId, seller.id);
      const { order, session } = await store.transitionOrderById(orderId, "cancel");
      risk.onPaymentConfirmed(order.id);
      await risk.onOrderClosed(order, "boomed").catch((err) => console.error("[risk]", err));
      emitOrderPrivate(io, session.roomCode, "order:updated", order);
      res.json({ order });
    }),
  );

  router.post(
    "/orders/:orderId/confirm",
    withSellerAuth(store, async (req, res, { seller }) => {
      const orderId = String(req.params.orderId ?? "");
      await requireOwnedOrder(orderId, seller.id);
      const { updatedAt } = parseBody(PaymentBody, req.body);
      const { order, session } = await store.transitionOrderById(orderId, "confirm", updatedAt);
      risk.onPaymentConfirmed(order.id);
      emitOrderPrivate(io, session.roomCode, "order:updated", order);
      emitOrderPrivate(io, session.roomCode, "payment:confirmed", order);
      res.json({ order });
    }),
  );

  router.post(
    "/orders/:orderId/deliver",
    withSellerAuth(store, async (req, res, { seller }) => {
      const orderId = String(req.params.orderId ?? "");
      await requireOwnedOrder(orderId, seller.id);
      const { order, session } = await store.transitionOrderById(orderId, "deliver");
      await risk.onOrderClosed(order, "completed").catch((err) => console.error("[risk]", err));
      emitOrderPrivate(io, session.roomCode, "order:updated", order);
      res.json({ order });
    }),
  );

  router.post(
    "/orders/:orderId/remind",
    withSellerAuth(store, async (req, res, { seller }) => {
      const orderId = String(req.params.orderId ?? "");
      await requireOwnedOrder(orderId, seller.id);
      const { order, session } = await store.transitionOrderById(orderId, "remind");
      const message = `Nhắc thanh toán đơn #${order.code} (${order.total.toLocaleString("vi-VN")}đ): ${deps.orderUrl(order.publicToken)}`;
      io.to(sellerRoom(session.roomCode))
        .to(buyerRoom(session.id, order.buyer.externalId))
        .emit("reply:new", {
          buyerExternalId: order.buyer.externalId,
          text: message,
        });
      if (order.buyer.source === "facebook" && deps.replyOnFacebook) {
        const fbCommentId = [...order.sourceCommentIds]
          .reverse()
          .find((id) => id.startsWith("fb_"))
          ?.slice(3);
        if (fbCommentId) {
          deps.replyOnFacebook(session.id, fbCommentId, message).catch((err) => console.error("[facebook] remind failed", err));
        }
      }
      res.json({ message });
    }),
  );

  // Public capability routes via unguessable publicToken
  router.get("/orders/:token", async (req, res, next) => {
    try {
      const { order, roomCode } = await requirePublicOrder(String(req.params.token ?? ""));
      res.json({ order: toPublicOrder(order, roomCode) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/orders/:token/report-payment", async (req, res, next) => {
    try {
      const token = String(req.params.token ?? "");
      const { updatedAt } = parseBody(PaymentBody, req.body);
      const { order, session, changed } = await store.transitionOrderByPublicToken(token, "report_payment", updatedAt);
      if (changed) {
        risk.onPaymentReported(order);
        emitOrderPrivate(io, session.roomCode, "order:updated", order);
        emitOrderPrivate(io, session.roomCode, "payment:reported", order);
      }
      res.json({ order: toPublicOrder(order, session.roomCode) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:token/qr.png", async (req, res, next) => {
    try {
      if (!deps.vietqr) {
        res.status(503).json({ error: "Chưa cấu hình VIETQR_ACCOUNT_NUMBER" });
        return;
      }
      const { order, roomCode } = await requirePublicOrder(String(req.params.token ?? ""));
      if (order.status === "cancelled") {
        res.status(404).json({ error: "Không tìm thấy đơn" });
        return;
      }
      if (order.total <= 0) {
        throw new ValidationError("Đơn hàng chưa có giá trị thanh toán");
      }
      const png = await vietQrPngBuffer({ ...deps.vietqr, amount: order.total, addInfo: paymentReference(roomCode, order.code) });
      res.type("png").set("Cache-Control", "no-store").send(png);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
