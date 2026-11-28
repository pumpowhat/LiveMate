import type { Comment, CommentVerdict, LiveSession, Order, Product, RiskAlert } from "./domain.ts";

export type SocketAck = { ok: true } | { ok: false; error: string };

/**
 * Sự kiện Socket.IO. Mỗi phiên live là một room tên = roomCode.
 * Người bán join thêm room `seller:<roomCode>` (sự kiện chỉ người bán thấy).
 * Dữ liệu Order chỉ gửi tới `seller:<roomCode>`, `buyer:<sessionId>:<buyerExternalId>`, hoặc `order:<publicToken>`.
 */
export interface ServerToClientEvents {
  "comment:new": (comment: Comment) => void;
  /** Kết quả xử lý bình luận (chỉ gửi người bán). */
  "comment:verdict": (p: { commentId: string; verdict: CommentVerdict; orderId?: string }) => void;
  "order:created": (order: Order) => void;
  "order:updated": (order: Order) => void;
  "session:updated": (session: LiveSession) => void;
  "product:featured": (p: { sessionId: string; product: Product | null }) => void;
  "payment:reported": (order: Order) => void;
  "payment:confirmed": (order: Order) => void;
  /** Câu trả lời của shop cho người mua (AI `ask`, hết hàng, link đơn...). */
  "reply:new": (p: { buyerExternalId: string; commentId?: string; text: string }) => void;
  "risk:alert": (alert: RiskAlert) => void;
}

export interface ClientToServerEvents {
  "room:join": (p: { roomCode: string; asSeller?: boolean; buyerToken?: string }, ack?: (res: SocketAck) => void) => void;
  /** Bình luận từ phòng live dự phòng hoặc extension. */
  "comment:send": (
    p: {
      roomCode: string;
      buyerExternalId?: string;
      buyerName?: string;
      text: string;
      source?: "room" | "extension";
      buyerToken?: string;
    },
    ack?: (res: SocketAck) => void,
  ) => void;
  /** Người mua bấm "Đã chuyển". */
  "payment:report": (p: { publicToken: string }, ack?: (res: SocketAck) => void) => void;
  /** Theo dõi trạng thái một đơn hàng cụ thể qua publicToken. */
  "order:join": (p: { publicToken: string }, ack?: (res: SocketAck) => void) => void;
}

export const sellerRoom = (roomCode: string) => `seller:${roomCode}`;
export const buyerRoom = (sessionId: string, buyerExternalId: string) => `buyer:${sessionId}:${buyerExternalId}`;
export const orderRoom = (publicToken: string) => `order:${publicToken}`;
