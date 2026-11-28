import type { AiAction, Order, Product } from "@livemate/shared";
import type { LineRef } from "./gateway.ts";

/**
 * Bước [5]: kiểm tra hành động của AI với danh mục, tồn kho và đơn hiện có,
 * rồi chuyển thành thao tác cụ thể. Không gọi I/O — dễ test.
 */
export type Operation =
  | { kind: "add"; commentId: string; buyer: string; line: LineRef & { qty: number } }
  | { kind: "update"; commentId: string; buyer: string; orderId: string; line: LineRef; patch: { productId?: string; size?: string | null; qty?: number } }
  | { kind: "remove"; commentId: string; buyer: string; orderId: string; line: LineRef | null }
  | { kind: "reply"; commentId: string; buyer: string; text: string; reason: ReplyReason; meta?: ReplyMeta }
  /** Đơn đã được người bán sửa tay: AI không tự đổi, chỉ báo người bán. */
  | { kind: "needs_review"; commentId: string; buyer: string; orderId: string; action: AiAction; reason: "seller_edited" | "payment_reported" };

export interface ReplyMeta {
  productCode: string;
  size: string | null;
}

export type ReplyReason = "ask" | "unknown_item" | "invalid_size" | "missing_size" | "out_of_stock" | "no_order" | "not_in_order";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const sizeList = (p: Product) => p.sizes.join("/");
const stockOf = (p: Product, size: string | null) => p.stock[size ?? ""] ?? 0;

/**
 * Có trạng thái: sau khi thực thi thao tác, gọi `setOrder` với đơn mới để hành
 * động kế tiếp trong cùng lô (ví dụ "chốt V03 M" rồi "đổi sang L") thấy đơn đó.
 */
export function createResolver(catalog: Product[], initialOrders: Map<string, Order>) {
  const openOrders = new Map(initialOrders);
  const byCode = new Map(catalog.map((p) => [p.code.toUpperCase(), p]));
  // Tồn kho "ảo" trong lô: hai người cùng chốt món cuối cùng trong một lô.
  const reserved = new Map<string, number>();
  const take = (p: Product, size: string | null, qty: number) => {
    const key = `${p.id}|${size ?? ""}`;
    const left = stockOf(p, size) - (reserved.get(key) ?? 0);
    if (left < qty) return left;
    reserved.set(key, (reserved.get(key) ?? 0) + qty);
    return -1; // ok
  };
  let ops: Operation[] = [];
  const reply = (a: AiAction, text: string, reason: ReplyReason, meta?: ReplyMeta) =>
    ops.push({ kind: "reply", commentId: a.commentId, buyer: a.buyer, text, reason, ...(meta ? { meta } : {}) });

  /** Chuẩn hóa size theo món; trả về undefined nếu size không hợp lệ. */
  const normSize = (p: Product, size: string | null): string | null | undefined => {
    if (p.sizes.length === 0) return null;
    if (size === null) return undefined;
    return p.sizes.find((s) => s.toUpperCase() === size.toUpperCase());
  };

  function resolve(a: AiAction): Operation[] {
    ops = [];
    resolveOne(a);
    return ops;
  }

  function resolveOne(a: AiAction): void {
    if (a.action === "ask") {
      const p = a.item ? byCode.get(a.item.toUpperCase()) : undefined;
      if (p && (a.reason === "invalid_size" || a.reason === "missing_size" || a.reason === "unknown_item")) {
        // Không tin dữ kiện LLM tự viết về size / mã món: viết lại từ danh mục.
        const size = normSize(p, a.size);
        if (a.reason === "invalid_size" && a.size !== null && size !== undefined) {
          // LLM bảo size không có nhưng danh mục có -> ghi đơn như khách yêu cầu.
          resolveOne({ commentId: a.commentId, buyer: a.buyer, action: "create", item: p.code, size, qty: a.qty ?? 1 });
          return;
        }
        if (p.sizes.length === 0) reply(a, a.reply, "ask");
        else if (a.size !== null && size === undefined) reply(a, `${p.code} chỉ có size ${sizeList(p)} ạ.`, "invalid_size");
        else reply(a, `Bạn chọn size nào ạ? ${p.code} có size ${sizeList(p)}.`, "missing_size");
        return;
      }
      if (a.reason === "unknown_item" && a.item && !p) {
        reply(a, `Shop chưa có mã ${a.item}, bạn xem lại giúp shop nhé.`, "unknown_item");
        return;
      }
      reply(a, a.reply, "ask");
      return;
    }

    const order = openOrders.get(a.buyer);
    // Người bán đã sửa tay, hoặc khách đã báo chuyển tiền (số tiền đã chốt): AI không tự đổi đơn,
    // kể cả thêm món, vì tổng tiền sẽ lệch với khoản khách đã chuyển. Để người bán xem.
    if (order && ((a.action !== "create" && order.sellerEdited) || order.status === "awaiting_confirmation")) {
      const reason = order.status === "awaiting_confirmation" ? "payment_reported" : "seller_edited";
      ops.push({ kind: "needs_review", commentId: a.commentId, buyer: a.buyer, orderId: order.id, action: a, reason });
      return;
    }

    if (a.action === "cancel") {
      if (!order) {
        reply(a, "Shop chưa thấy đơn nào của bạn trong buổi live này ạ.", "no_order");
        return;
      }
      if (a.item === null) {
        ops.push({ kind: "remove", commentId: a.commentId, buyer: a.buyer, orderId: order.id, line: null });
        return;
      }
      const lines = order.items.filter((i) => i.productCode.toUpperCase() === a.item!.toUpperCase());
      if (lines.length === 0) {
        reply(a, `Đơn của bạn không có món ${a.item} ạ.`, "not_in_order");
        return;
      }
      for (const l of lines) ops.push({ kind: "remove", commentId: a.commentId, buyer: a.buyer, orderId: order.id, line: { productId: l.productId, size: l.size } });
      return;
    }

    const p = byCode.get(a.item.toUpperCase());
    if (!p) {
      reply(a, `Shop chưa có mã ${a.item}, bạn xem lại giúp shop nhé.`, "unknown_item");
      return;
    }

    if (a.action === "create") {
      const size = normSize(p, a.size);
      if (size === undefined) {
        if (a.size === null) reply(a, `Bạn chọn size nào ạ? ${p.code} có size ${sizeList(p)}.`, "missing_size");
        else reply(a, `${p.code} chỉ có size ${sizeList(p)} ạ.`, "invalid_size");
        return;
      }
      const left = take(p, size, a.qty);
      if (left >= 0) {
        reply(a, left === 0 ? `${p.code}${size ? ` size ${size}` : ""} hết hàng rồi ạ.` : `${p.code}${size ? ` size ${size}` : ""} chỉ còn ${left} cái ạ.`, "out_of_stock", { productCode: p.code, size });
        return;
      }
      ops.push({ kind: "add", commentId: a.commentId, buyer: a.buyer, line: { productId: p.id, size, qty: a.qty } });
      return;
    }

    // update
    if (!order) {
      // Sửa khi chưa có đơn: coi như tạo mới nếu đủ thông tin.
      const size = normSize(p, a.size);
      if (size === undefined) {
        reply(a, `Bạn chọn size nào ạ? ${p.code} có size ${sizeList(p)}.`, "missing_size");
        return;
      }
      ops.push({ kind: "add", commentId: a.commentId, buyer: a.buyer, line: { productId: p.id, size, qty: a.qty ?? 1 } });
      return;
    }
    const line = order.items.find((i) => i.productId === p.id);
    if (!line) {
      reply(a, `Đơn của bạn chưa có ${p.code} ạ. Bạn muốn lấy thêm ${p.code} không?`, "not_in_order");
      return;
    }
    const target = a.newItem ? byCode.get(a.newItem.toUpperCase()) : p;
    if (!target) {
      reply(a, `Shop chưa có mã ${a.newItem}, bạn xem lại giúp shop nhé.`, "unknown_item");
      return;
    }
    // Đổi món mà không nói size: giữ size cũ nếu món mới có size đó.
    const wantedSize = a.size ?? line.size;
    const size = normSize(target, wantedSize);
    if (size === undefined) {
      reply(a, `${target.code} có size ${sizeList(target)}, bạn chọn size nào ạ?`, a.size ? "invalid_size" : "missing_size");
      return;
    }
    const qty = a.qty ?? line.qty;
    const sameLine = target.id === line.productId && size === line.size;
    const extra = sameLine ? qty - line.qty : qty;
    if (extra > 0) {
      const left = take(target, size, extra);
      if (left >= 0) {
        reply(a, `${target.code}${size ? ` size ${size}` : ""} ${left === 0 ? "hết hàng rồi" : `chỉ còn ${left} cái`} ạ.`, "out_of_stock", { productCode: target.code, size });
        return;
      }
    }
    const patch: { productId?: string; size?: string | null; qty?: number } = {};
    if (target.id !== line.productId) patch.productId = target.id;
    if (size !== line.size) patch.size = size;
    if (qty !== line.qty) patch.qty = qty;
    if (Object.keys(patch).length === 0) return; // không đổi gì
    ops.push({ kind: "update", commentId: a.commentId, buyer: a.buyer, orderId: order.id, line: { productId: line.productId, size: line.size }, patch });
  }

  return {
    resolve,
    setOrder(buyer: string, order: Order) {
      if (order.status === "cancelled" || order.items.length === 0) openOrders.delete(buyer);
      else openOrders.set(buyer, order);
    },
  };
}

/** Tiện cho test: giải cả lô với đơn cố định (không thực thi). */
export function resolveActions(actions: AiAction[], catalog: Product[], openOrders: Map<string, Order>): Operation[] {
  const r = createResolver(catalog, openOrders);
  return actions.flatMap((a) => r.resolve(a));
}

export { vnd };
