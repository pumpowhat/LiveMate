import type { Comment, CommentVerdict, LiveSession, Order, RiskAlert } from "./domain.ts";

/**
 * Sự kiện Socket.IO. Mỗi phiên live là một room tên = roomCode.
 * Người bán join thêm room `seller:<roomCode>` (sự kiện chỉ người bán thấy).
 */
export interface ServerToClientEvents {
  "comment:new": (comment: Comment) => void;
  /** Kết quả xử lý bình luận (chỉ gửi người bán). */
  "comment:verdict": (p: { commentId: string; verdict: CommentVerdict; orderId?: string }) => void;
  "order:created": (order: Order) => void;
  "order:updated": (order: Order) => void;
  "session:updated": (session: LiveSession) => void;
  /** Câu trả lời của shop cho người mua (AI `ask`, hết hàng, link đơn...). */
  "reply:new": (p: { buyerExternalId: string; commentId?: string; text: string }) => void;
  "risk:alert": (alert: RiskAlert) => void;
}

export interface ClientToServerEvents {
  "room:join": (p: { roomCode: string; asSeller?: boolean }) => void;
  /** Bình luận từ phòng live dự phòng hoặc extension. */
  "comment:send": (p: { roomCode: string; buyerExternalId: string; buyerName: string; text: string; source?: "room" | "extension" }) => void;
  /** Người mua bấm "Đã chuyển". */
  "payment:report": (p: { publicToken: string }) => void;
}

export const sellerRoom = (roomCode: string) => `seller:${roomCode}`;
