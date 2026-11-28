import { createHash } from "node:crypto";
import type { Order, PublicOrder } from "@livemate/shared";

export function paymentReference(roomCode: string, orderCode: string): string {
  const reference = `LM ${roomCode} ${orderCode}`;
  if (reference.length <= 25 && /^[A-Z0-9]+$/.test(roomCode)) return reference;

  // Phòng tùy chỉnh có thể chứa ký tự VietQR không hỗ trợ hoặc vượt giới hạn 25 ký tự.
  const roomKey = createHash("sha256").update(roomCode).digest("hex").toUpperCase();
  return `LM ${roomKey.slice(0, 20 - orderCode.length)} ${orderCode}`;
}

export function toPublicOrder(order: Order, roomCode: string): PublicOrder {
  return {
    code: order.code,
    buyer: { displayName: order.buyer.displayName },
    items: order.items.map(({ productCode, productName, size, qty, unitPrice }) => ({
      productCode, productName, size, qty, unitPrice,
    })),
    total: order.total,
    status: order.status,
    publicToken: order.publicToken,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paymentReference: paymentReference(roomCode, order.code),
  };
}
