import type { CommentVerdict, OrderStatus, RiskKind } from "./types";

const vndFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

export function formatVnd(amount: number): string {
  return vndFormatter.format(amount);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" | "outline" }
> = {
  pending_payment: { label: "Chờ thanh toán", variant: "warning" },
  awaiting_confirmation: { label: "Chờ đối soát", variant: "default" },
  paid: { label: "Đã thanh toán", variant: "success" },
  delivered: { label: "Đã giao", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "danger" },
};

export const VERDICT_META: Record<
  CommentVerdict,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" | "outline" }
> = {
  create: { label: "Chốt đơn", variant: "success" },
  update: { label: "Đổi đơn", variant: "default" },
  cancel: { label: "Hủy đơn", variant: "danger" },
  ask: { label: "Hỏi đáp", variant: "warning" },
  queued: { label: "Đang xử lý", variant: "outline" },
  ignored: { label: "Bỏ qua", variant: "secondary" },
  unparsed: { label: "Chưa rõ", variant: "outline" },
};

export const RISK_KIND_LABELS: Record<RiskKind, string> = {
  buyer_history_boom: "Lịch sử boom đơn",
  unusual_quantity: "Số lượng / tần suất bất thường",
  payment_not_found: "Chưa thấy tiền về",
  out_of_stock: "Hết hàng",
};
