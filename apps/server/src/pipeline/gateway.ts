import type { CommentSource, LiveSession, Order, Product } from "@livemate/shared";

/**
 * Ranh giới giữa pipeline AI (Nghĩa) và lớp phiên live / đơn hàng (Nhật, issue #4 #5).
 * Mô hình: mỗi người mua có tối đa MỘT đơn đang mở trong một phiên; "create" thêm
 * dòng hàng vào đơn đó (tạo đơn nếu chưa có).
 *
 * `InMemoryOrderGateway` bên dưới dùng cho test/eval; bản thật do service Prisma implement.
 */
export interface BuyerRef {
  externalId: string;
  name: string;
  source: CommentSource;
}

export interface LineRef {
  productId: string;
  size: string | null;
}

export interface SessionContext {
  session: LiveSession;
  catalog: Product[];
  /** Mã món đã giới thiệu trước món hiện tại, mới nhất trước. */
  previouslyFeatured: string[];
}

export type ReviewReason = "seller_edited" | "payment_reported";

/**
 * Gateway ném lỗi này khi, tại thời điểm ghi (đã khóa đơn), đơn không còn cho AI tự đổi:
 * - khách đã báo chuyển tiền (awaiting_confirmation): chặn mọi thao tác, kể cả thêm món;
 * - người bán đã sửa tay (sellerEdited): chặn sửa / bỏ món, vẫn cho thêm món.
 * Resolver đã kiểm tra trên bản chụp trước khi gọi LLM; lớp này chặn trường hợp trạng thái
 * đổi trong lúc chờ LLM. Pipeline chuyển lỗi thành needs_review.
 */
export class OrderLockedError extends Error {
  constructor(readonly orderId: string, readonly reason: ReviewReason) {
    super(`Order ${orderId} is locked for AI changes (${reason})`);
    this.name = "OrderLockedError";
  }
}

export function aiLockReason(
  order: { status: string; sellerEdited: boolean },
  kind: "add" | "change",
): ReviewReason | null {
  if (order.status === "awaiting_confirmation") return "payment_reported";
  if (kind === "change" && order.sellerEdited) return "seller_edited";
  return null;
}

export interface OrderGateway {
  getSessionContext(sessionId: string): Promise<SessionContext>;
  /** Đơn đang mở (pending_payment / awaiting_confirmation) của từng người mua. */
  getOpenOrders(sessionId: string, buyerExternalIds: string[]): Promise<Map<string, Order>>;
  /** Thêm hàng; gộp số lượng nếu đã có cùng món + size. Trừ tồn kho. Ném OrderLockedError (xem trên). */
  addItem(sessionId: string, buyer: BuyerRef, line: LineRef & { qty: number }, commentId: string): Promise<Order>;
  /** Sửa một dòng hàng (đổi size / số lượng / món). Cập nhật tồn kho. Ném OrderLockedError. */
  updateItem(orderId: string, line: LineRef, patch: { productId?: string; size?: string | null; qty?: number }, commentId: string): Promise<Order>;
  /** Bỏ một dòng hàng, hoặc hủy cả đơn khi line = null. Hoàn tồn kho. Ném OrderLockedError. */
  removeItem(orderId: string, line: LineRef | null, commentId: string): Promise<Order>;
}
