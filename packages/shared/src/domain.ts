import { z } from "zod";

/** Nguồn bình luận / người mua. */
export const CommentSource = z.enum(["facebook", "room", "extension"]);
export type CommentSource = z.infer<typeof CommentSource>;

export const OrderStatus = z.enum([
  "pending_payment", // vừa chốt, chờ thanh toán
  "awaiting_confirmation", // người mua báo "Đã chuyển", chờ người bán đối soát
  "paid",
  "delivered",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const Product = z.object({
  id: z.string(),
  /** Mã ngắn người bán đọc trên live, ví dụ "V03". Duy nhất trong một shop. */
  code: z.string(),
  name: z.string(),
  /** Danh sách size hợp lệ; rỗng nghĩa là món không có size. */
  sizes: z.array(z.string()),
  /** Giá VND. */
  price: z.number().int().nonnegative(),
  /** Tồn kho theo size ("" khi món không có size). */
  stock: z.record(z.string(), z.number().int().nonnegative()),
});
export type Product = z.infer<typeof Product>;

export const Buyer = z.object({
  id: z.string(),
  source: CommentSource,
  /** Id ở nguồn ngoài: Facebook user id (page-scoped) hoặc mã người mua trong phòng live. */
  externalId: z.string(),
  displayName: z.string(),
});
export type Buyer = z.infer<typeof Buyer>;

export const Comment = z.object({
  id: z.string(),
  sessionId: z.string(),
  source: CommentSource,
  /** Id bình luận ở nguồn ngoài (Facebook comment id) — để trả lời bình luận và chống trùng. */
  externalId: z.string().optional(),
  buyerExternalId: z.string(),
  buyerName: z.string(),
  text: z.string(),
  createdAt: z.string(), // ISO
  verdict: z.lazy(() => CommentVerdict).optional(),
  verdictOrderId: z.string().optional(),
});
export type Comment = z.infer<typeof Comment>;

/** Kết quả xử lý một bình luận, để màn hình người bán đánh dấu. */
export const CommentVerdict = z.enum(["ignored", "queued", "create", "update", "cancel", "ask", "unparsed"]);
export type CommentVerdict = z.infer<typeof CommentVerdict>;

export const OrderItem = z.object({
  productId: z.string(),
  productCode: z.string(),
  productName: z.string(),
  size: z.string().nullable(),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const Order = z.object({
  id: z.string(),
  /** Mã ngắn hiện cho người mua và đưa vào nội dung chuyển khoản, ví dụ "A12". */
  code: z.string(),
  sessionId: z.string(),
  buyer: Buyer,
  items: z.array(OrderItem),
  total: z.number().int().nonnegative(),
  status: OrderStatus,
  /** Token khó đoán cho trang đơn công khai /o/<publicToken>. */
  publicToken: z.string(),
  /** Bình luận đã tạo/sửa đơn gần nhất. */
  sourceCommentIds: z.array(z.string()),
  /** true khi người bán đã sửa tay — AI không tự ghi đè nữa. */
  sellerEdited: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof Order>;

export type PublicOrder = Pick<Order, "code" | "total" | "status" | "publicToken" | "createdAt" | "updatedAt"> & {
  buyer: Pick<Buyer, "displayName">;
  items: Omit<OrderItem, "productId">[];
  paymentReference: string;
};

export const RiskKind = z.enum([
  "buyer_history_boom", // khách từng boom đơn
  "unusual_quantity", // chốt số lượng / tần suất bất thường
  "payment_not_found", // báo đã chuyển nhưng chưa thấy giao dịch
  "out_of_stock", // chốt món hết hàng
]);
export type RiskKind = z.infer<typeof RiskKind>;

export const RiskAlert = z.object({
  id: z.string(),
  sessionId: z.string(),
  orderId: z.string().nullable(),
  buyerExternalId: z.string(),
  kind: RiskKind,
  severity: z.enum(["info", "warning", "danger"]),
  message: z.string(),
  createdAt: z.string(),
});
export type RiskAlert = z.infer<typeof RiskAlert>;

export const Seller = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
});
export type Seller = z.infer<typeof Seller>;

export const LiveSession = z.object({
  id: z.string(),
  /** Mã phòng = tên room Socket.IO. */
  roomCode: z.string(),
  sellerId: z.string().optional(),
  status: z.enum(["live", "ended"]),
  featuredProductId: z.string().nullable(),
  /** Facebook live video / post id đang theo dõi bình luận (nếu có). */
  facebookObjectId: z.string().nullable(),
  facebookPageId: z.string().nullable().optional(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type LiveSession = z.infer<typeof LiveSession>;
