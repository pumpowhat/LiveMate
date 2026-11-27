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

export interface OrderGateway {
  getSessionContext(sessionId: string): Promise<SessionContext>;
  /** Đơn đang mở (pending_payment / awaiting_confirmation) của từng người mua. */
  getOpenOrders(sessionId: string, buyerExternalIds: string[]): Promise<Map<string, Order>>;
  /** Thêm hàng; gộp số lượng nếu đã có cùng món + size. Trừ tồn kho. */
  addItem(sessionId: string, buyer: BuyerRef, line: LineRef & { qty: number }, commentId: string): Promise<Order>;
  /** Sửa một dòng hàng (đổi size / số lượng / món). Cập nhật tồn kho. */
  updateItem(orderId: string, line: LineRef, patch: { productId?: string; size?: string | null; qty?: number }, commentId: string): Promise<Order>;
  /** Bỏ một dòng hàng, hoặc hủy cả đơn khi line = null. Hoàn tồn kho. */
  removeItem(orderId: string, line: LineRef | null, commentId: string): Promise<Order>;
}
