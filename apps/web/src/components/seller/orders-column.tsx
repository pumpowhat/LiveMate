"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  Copy,
  ExternalLink,
  PackageCheck,
  Pencil,
  ShoppingBag,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormField, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import { formatTime, formatVnd, ORDER_STATUS_META } from "@/lib/format";
import type { LiveSession, Order, OrderItem, OrderStatus, Product } from "@/lib/types";

interface OrdersColumnProps {
  session: LiveSession;
  catalog: Product[];
  orders: Order[];
  onOrderUpdated: (order: Order) => void;
}

const STATUS_FILTERS: Array<{ value: "all" | OrderStatus; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "pending_payment", label: "Chờ TT" },
  { value: "awaiting_confirmation", label: "Đối soát" },
  { value: "paid", label: "Đã TT" },
  { value: "delivered", label: "Đã giao" },
  { value: "cancelled", label: "Đã hủy" },
];

export function OrdersColumn({ session, catalog, orders, onOrderUpdated }: OrdersColumnProps) {
  const [filter, setFilter] = React.useState<"all" | OrderStatus>("all");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [remindText, setRemindText] = React.useState<string | null>(null);

  const [editTarget, setEditTarget] = React.useState<{ order: Order; item: OrderItem } | null>(null);
  const [patchProductId, setPatchProductId] = React.useState("");
  const [patchSize, setPatchSize] = React.useState("");
  const [patchQty, setPatchQty] = React.useState("1");
  const [patchError, setPatchError] = React.useState<string | null>(null);
  const [patching, setPatching] = React.useState(false);

  const filtered = React.useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter],
  );

  async function runOrderAction(
    orderId: string,
    action: () => Promise<{ order: Order }>,
    successTitle: string,
  ) {
    setBusyId(orderId);
    try {
      const res = await action();
      onOrderUpdated(res.order);
      toast({ title: successTitle, description: `Đơn #${res.order.code}`, variant: "success" });
    } catch (err) {
      toast({
        title: "Không thể cập nhật đơn",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemind(order: Order) {
    setBusyId(order.id);
    try {
      const res = await api.orders.remind(order.id);
      setRemindText(res.message);
    } catch (err) {
      toast({
        title: "Không tạo được lời nhắc",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  function openEditLine(order: Order, item: OrderItem) {
    setEditTarget({ order, item });
    setPatchProductId(item.productId);
    setPatchSize(item.size ?? "");
    setPatchQty(String(item.qty));
    setPatchError(null);
  }

  async function handleSaveLine(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setPatchError(null);
    const qtyNum = Number.parseInt(patchQty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setPatchError("Số lượng phải lớn hơn 0.");
      return;
    }
    setPatching(true);
    try {
      const res = await api.orders.patchLine(session.id, editTarget.order.id, {
        line: { productId: editTarget.item.productId, size: editTarget.item.size },
        patch: {
          productId: patchProductId,
          size: patchSize.trim() ? patchSize.trim() : null,
          qty: qtyNum,
        },
      });
      onOrderUpdated(res.order);
      toast({ title: "Đã sửa dòng hàng", description: `Đơn #${res.order.code}`, variant: "success" });
      setEditTarget(null);
    } catch (err) {
      setPatchError(err instanceof ApiError ? err.message : "Không thể sửa đơn hàng.");
    } finally {
      setPatching(false);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-2.5 border-b py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Đơn hàng &amp; Đối soát</CardTitle>
            <p className="text-xs text-muted-foreground">{orders.length} đơn trong phiên</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center">
            <ShoppingBag className="h-7 w-7 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">Chưa có đơn hàng nào</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Đơn hàng tự động chốt từ bình luận sẽ hiển thị ở đây để bạn duyệt và đối soát.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => {
              const statusMeta = ORDER_STATUS_META[order.status];
              const isBusy = busyId === order.id;

              return (
                <div key={order.id} className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">#{order.code}</span>
                        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        {order.sellerEdited && <Badge variant="outline">Đã sửa tay</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {order.buyer.displayName} • {formatTime(order.updatedAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary">{formatVnd(order.total)}</p>
                      <Link
                        href={`/o/${encodeURIComponent(order.publicToken)}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
                      >
                        Trang đơn <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>

                  <ul className="mt-2.5 space-y-1.5 border-t pt-2">
                    {order.items.map((item, idx) => (
                      <li
                        key={`${order.id}-${item.productId}-${item.size ?? "none"}-${idx}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="truncate">
                          <span className="font-medium">{item.productCode}</span> {item.productName}
                          {item.size ? ` (${item.size})` : ""} × {item.qty}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-muted-foreground">
                            {formatVnd(item.unitPrice * item.qty)}
                          </span>
                          {order.status !== "cancelled" && order.status !== "delivered" && (
                            <button
                              type="button"
                              onClick={() => openEditLine(order, item)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Sửa dòng hàng"
                              aria-label="Sửa dòng hàng"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5">
                    {order.status === "pending_payment" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() =>
                            runOrderAction(order.id, () => api.orders.approve(order.id), "Đã duyệt đơn")
                          }
                        >
                          <ThumbsUp className="h-3.5 w-3.5" /> Duyệt
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => handleRemind(order)}
                        >
                          <Bell className="h-3.5 w-3.5" /> Nhắc TT
                        </Button>
                      </>
                    )}

                    {(order.status === "pending_payment" || order.status === "awaiting_confirmation") && (
                      <Button
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          runOrderAction(
                            order.id,
                            () => api.orders.confirm(order.id),
                            "Đã xác nhận thanh toán",
                          )
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận tiền về
                      </Button>
                    )}

                    {order.status === "paid" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() =>
                          runOrderAction(
                            order.id,
                            () => api.orders.deliver(order.id),
                            "Đã đánh dấu đã giao",
                          )
                        }
                      >
                        <PackageCheck className="h-3.5 w-3.5" /> Đã giao hàng
                      </Button>
                    )}

                    {order.status !== "cancelled" && order.status !== "delivered" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={isBusy}
                        onClick={() =>
                          runOrderAction(order.id, () => api.orders.cancel(order.id), "Đã hủy đơn")
                        }
                      >
                        <XCircle className="h-3.5 w-3.5" /> Hủy
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa dòng hàng — Đơn #{editTarget?.order.code}</DialogTitle>
            <DialogDescription>
              Sau khi người bán sửa tay, hệ thống AI sẽ không tự ghi đè đơn này nữa.
            </DialogDescription>
          </DialogHeader>
          <Form onSubmit={handleSaveLine}>
            <FormField>
              <FormLabel htmlFor="patch-product">Sản phẩm</FormLabel>
              <select
                id="patch-product"
                value={patchProductId}
                onChange={(e) => setPatchProductId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {catalog.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name} ({formatVnd(p.price)})
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField>
                <FormLabel htmlFor="patch-size">Size (để trống nếu không có)</FormLabel>
                <Input
                  id="patch-size"
                  value={patchSize}
                  onChange={(e) => setPatchSize(e.target.value)}
                  placeholder="M"
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="patch-qty">Số lượng</FormLabel>
                <Input
                  id="patch-qty"
                  type="number"
                  min={1}
                  value={patchQty}
                  onChange={(e) => setPatchQty(e.target.value)}
                  required
                />
              </FormField>
            </div>
            <FormMessage>{patchError}</FormMessage>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                Đóng
              </Button>
              <Button type="submit" disabled={patching}>
                {patching ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remindText)} onOpenChange={(open) => !open && setRemindText(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tin nhắn nhắc thanh toán</DialogTitle>
            <DialogDescription>Sao chép nội dung bên dưới để gửi cho khách hàng.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{remindText}</div>
          <DialogFooter>
            <Button
              type="button"
              onClick={async () => {
                if (!remindText) return;
                await navigator.clipboard.writeText(remindText);
                toast({ title: "Đã sao chép lời nhắc", variant: "success" });
              }}
            >
              <Copy className="h-4 w-4" /> Sao chép
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
