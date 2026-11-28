import { buyerRoom, orderRoom, sellerRoom, type ClientToServerEvents, type Comment, type Order, type ServerToClientEvents } from "@livemate/shared";
import type { Server } from "socket.io";
import type { PipelineSink } from "../pipeline/pipeline.ts";

export type Io = Server<ClientToServerEvents, ServerToClientEvents>;

export interface SinkDeps {
  io: Io;
  /** sessionId -> roomCode */
  roomOf: (sessionId: string) => string | undefined;
  /** Cho phép gửi reply:new công khai chỉ ở luồng DEMO dev script cũ. */
  isLegacyPublicDemo?: (sessionId: string) => boolean;
  /** Trả lời bình luận Facebook; bỏ trống khi chưa kết nối Fanpage. */
  replyOnFacebook?: (sessionId: string, fbCommentId: string, text: string) => Promise<void>;
  /** Link trang đơn công khai, ví dụ `${PUBLIC_WEB_URL}/o/${token}`. */
  orderUrl: (publicToken: string) => string;
  log?: (msg: string, extra?: unknown) => void;
}

export function emitOrderPrivate(
  io: Io,
  roomCode: string,
  event: "order:created" | "order:updated" | "payment:reported" | "payment:confirmed",
  order: Order,
): void {
  io.to(sellerRoom(roomCode))
    .to(buyerRoom(order.sessionId, order.buyer.externalId))
    .to(orderRoom(order.publicToken))
    .emit(event, order);
}

/**
 * Phát kết quả pipeline:
 * - Đơn hàng mới/cập nhật: CHỈ gửi tới người bán sở hữu phiên, phòng riêng người mua, và phòng đơn hàng.
 * - Câu trả lời của shop: gửi người bán + người mua mục tiêu (và DEMO dev script khi bật).
 * - Chỉ người bán: verdict từng bình luận, cảnh báo cần xem lại.
 * - Người mua Facebook: Fanpage trả lời bình luận (kèm link đơn khi vừa tạo đơn).
 */
export function createSocketSink(deps: SinkDeps): PipelineSink {
  const { io } = deps;
  const log = deps.log ?? ((m, e) => console.log(`[pipeline] ${m}`, e ?? ""));
  const fbReply = (sessionId: string, comment: Comment, text: string) => {
    if (comment.source !== "facebook" || !comment.externalId || !deps.replyOnFacebook) return;
    deps.replyOnFacebook(sessionId, comment.externalId, text).catch((err) => log("facebook reply failed", err));
  };

  return {
    onVerdict(sessionId, commentId, verdict, orderId) {
      const room = deps.roomOf(sessionId);
      if (room) io.to(sellerRoom(room)).emit("comment:verdict", { commentId, verdict, ...(orderId ? { orderId } : {}) });
    },

    onOrder(sessionId, order, created, comment) {
      const room = deps.roomOf(sessionId);
      if (room) emitOrderPrivate(io, room, created ? "order:created" : "order:updated", order);
      if (!created) return;
      // Đơn vừa tạo từ bình luận Facebook: trả lời kèm link thanh toán.
      const items = order.items.map((i) => `${i.qty} ${i.productCode}${i.size ? ` size ${i.size}` : ""}`).join(", ");
      fbReply(sessionId, comment, `Shop đã ghi đơn #${order.code}: ${items}. Thanh toán tại: ${deps.orderUrl(order.publicToken)}`);
    },

    onReply(sessionId, comment, text) {
      const room = deps.roomOf(sessionId);
      const payload = { buyerExternalId: comment.buyerExternalId, commentId: comment.id, text };
      if (room) {
        io.to(sellerRoom(room))
          .to(buyerRoom(sessionId, comment.buyerExternalId))
          .emit("reply:new", payload);
        if (deps.isLegacyPublicDemo?.(sessionId)) {
          io.to(room)
            .except(sellerRoom(room))
            .except(buyerRoom(sessionId, comment.buyerExternalId))
            .emit("reply:new", payload);
        }
      }
      fbReply(sessionId, comment, text);
    },

    onNeedsReview(sessionId, comment, op) {
      const room = deps.roomOf(sessionId);
      if (!room) return;
      io.to(sellerRoom(room)).emit("risk:alert", {
        id: `review_${comment.id}`,
        sessionId,
        orderId: op.orderId,
        buyerExternalId: comment.buyerExternalId,
        kind: "unusual_quantity",
        severity: "info",
        message: `Đơn đã được sửa tay, AI không tự đổi. Khách viết: "${comment.text}"`,
        createdAt: new Date().toISOString(),
      });
    },

    onError(sessionId, err, comments) {
      log(`batch failed (${comments.length} comments) in ${sessionId}`, err);
    },
  };
}
