import type { Comment, LiveSession, Order, OrderStatus, Product } from "@livemate/shared";
import { redactBuyerId } from "../auth/crypto.ts";
import { ConflictError, ValidationError } from "./errors.ts";

export type OrderActionKind = "approve" | "report_payment" | "confirm" | "deliver" | "cancel" | "remind";

export interface SessionSummary {
  session: LiveSession;
  revenue: number;
  counts: {
    total: number;
    pending_payment: number;
    awaiting_confirmation: number;
    paid: number;
    delivered: number;
    cancelled: number;
  };
  pendingOrders: Order[];
  topProducts: Array<{
    productCode: string;
    productName: string;
    qty: number;
    revenue: number;
  }>;
}

export const isOpenStatus = (status: OrderStatus): boolean =>
  status === "pending_payment" || status === "awaiting_confirmation";

export interface TransitionResult {
  nextStatus: OrderStatus;
  sellerEdited?: boolean;
  restoreStock: boolean;
  changed: boolean;
}

/**
 * Xác thực chuyển trạng thái đơn hàng hợp lệ.
 * Mọi trạng thái không hợp lệ đều ném ConflictError (HTTP 409).
 */
export function evaluateOrderTransition(current: OrderStatus, action: OrderActionKind): TransitionResult {
  switch (action) {
    case "approve": {
      if (!isOpenStatus(current)) {
        throw new ConflictError(`Không thể duyệt đơn ở trạng thái ${current}`);
      }
      return { nextStatus: current, sellerEdited: true, restoreStock: false, changed: true };
    }
    case "report_payment": {
      if (current === "awaiting_confirmation") {
        return { nextStatus: "awaiting_confirmation", restoreStock: false, changed: false };
      }
      if (current !== "pending_payment") {
        throw new ConflictError(`Không thể báo đã chuyển cho đơn ở trạng thái ${current}`);
      }
      return { nextStatus: "awaiting_confirmation", restoreStock: false, changed: true };
    }
    case "confirm": {
      if (current !== "awaiting_confirmation") {
        throw new ConflictError(`Không thể xác nhận thanh toán cho đơn ở trạng thái ${current}`);
      }
      return { nextStatus: "paid", restoreStock: false, changed: true };
    }
    case "deliver": {
      if (current !== "paid") {
        throw new ConflictError(`Chỉ có thể giao đơn đã thanh toán (hiện tại: ${current})`);
      }
      return { nextStatus: "delivered", restoreStock: false, changed: true };
    }
    case "cancel": {
      if (!isOpenStatus(current)) {
        throw new ConflictError(`Không thể hủy đơn ở trạng thái ${current}`);
      }
      return { nextStatus: "cancelled", restoreStock: true, changed: true };
    }
    case "remind": {
      if (!isOpenStatus(current)) {
        throw new ConflictError(`Chỉ có thể nhắc thanh toán đơn đang mở (hiện tại: ${current})`);
      }
      return { nextStatus: current, restoreStock: false, changed: false };
    }
  }
}

export function assertCurrentPaymentOrder(action: OrderActionKind, updatedAt: string, expectedUpdatedAt?: string): void {
  if ((action === "report_payment" || action === "confirm") && updatedAt !== expectedUpdatedAt) {
    throw new ConflictError("Đơn hàng đã thay đổi. Vui lòng tải lại và kiểm tra thông tin thanh toán.");
  }
}

export function normalizeProductData(input: {
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: Record<string, number>;
}): { code: string; name: string; sizes: string[]; price: number; stock: Record<string, number> } {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || code.length > 20) throw new ValidationError("Mã sản phẩm không hợp lệ (1-20 ký tự)");
  if (!name || name.length > 120) throw new ValidationError("Tên sản phẩm không hợp lệ (1-120 ký tự)");
  if (!Number.isInteger(input.price) || input.price < 0) throw new ValidationError("Giá sản phẩm phải là số nguyên >= 0");

  const sizes: string[] = [];
  const seenSizes = new Set<string>();
  for (const raw of input.sizes) {
    const s = raw.trim().toUpperCase();
    if (!s) continue;
    if (!seenSizes.has(s)) {
      seenSizes.add(s);
      sizes.push(s);
    }
  }

  const rawStockEntries = new Map<string, number>();
  for (const [key, qty] of Object.entries(input.stock)) {
    if (!Number.isInteger(qty) || qty < 0) {
      throw new ValidationError(`Tồn kho cho size "${key}" phải là số nguyên >= 0`);
    }
    rawStockEntries.set(key.trim().toUpperCase(), qty);
  }

  const stock: Record<string, number> = {};
  if (sizes.length === 0) {
    stock[""] = rawStockEntries.get("") ?? 0;
  } else {
    for (const size of sizes) {
      stock[size] = rawStockEntries.get(size) ?? 0;
    }
  }

  return { code, name, sizes, price: input.price, stock };
}

export function parseStockJson(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function computeSessionSummary(session: LiveSession, orders: Order[]): SessionSummary {
  const counts = {
    total: orders.length,
    pending_payment: 0,
    awaiting_confirmation: 0,
    paid: 0,
    delivered: 0,
    cancelled: 0,
  };
  let revenue = 0;
  const pendingOrders: Order[] = [];
  const productAgg = new Map<string, { productCode: string; productName: string; qty: number; revenue: number }>();

  for (const order of orders) {
    counts[order.status]++;
    if (isOpenStatus(order.status)) {
      pendingOrders.push(order);
    }
    if (order.status === "paid" || order.status === "delivered") {
      revenue += order.total;
      for (const item of order.items) {
        const current = productAgg.get(item.productCode) ?? {
          productCode: item.productCode,
          productName: item.productName,
          qty: 0,
          revenue: 0,
        };
        current.qty += item.qty;
        current.revenue += item.qty * item.unitPrice;
        productAgg.set(item.productCode, current);
      }
    }
  }

  const topProducts = [...productAgg.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
  return { session, revenue, counts, pendingOrders, topProducts };
}

export function toPublicComment(comment: Comment): Comment {
  return {
    id: comment.id,
    sessionId: comment.sessionId,
    source: comment.source,
    buyerExternalId: redactBuyerId(comment.sessionId, comment.buyerExternalId),
    buyerName: comment.buyerName,
    text: comment.text,
    createdAt: comment.createdAt,
  };
}

export function toPublicSession(session: LiveSession): LiveSession {
  const { sellerId: _sellerId, ...rest } = session;
  return rest;
}

export function cloneProduct(p: Product): Product {
  return { ...p, sizes: [...p.sizes], stock: { ...p.stock } };
}
