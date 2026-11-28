"use client";

import * as React from "react";
import { BarChart3, Bell, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import { formatVnd, ORDER_STATUS_META } from "@/lib/format";
import type { Order, OrderStatus, SessionSummary } from "@/lib/types";

interface SummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  onOrderUpdated: (order: Order) => void;
}

const COUNT_STATUSES: OrderStatus[] = [
  "pending_payment",
  "awaiting_confirmation",
  "paid",
  "delivered",
  "cancelled",
];

export function SummaryDialog({ open, onOpenChange, sessionId, onOrderUpdated }: SummaryDialogProps) {
  const [summary, setSummary] = React.useState<SessionSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = React.useState<string | null>(null);

  const loadSummary = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sessions.summary(sessionId);
      setSummary(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được báo cáo phiên live.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (open) void loadSummary();
  }, [open, loadSummary]);

  async function handleQuickConfirm(orderId: string) {
    setBusyOrderId(orderId);
    try {
      const res = await api.orders.confirm(orderId);
      onOrderUpdated(res.order);
      toast({ title: "Đã xác nhận thanh toán", description: `Đơn #${res.order.code}`, variant: "success" });
      await loadSummary();
    } catch (err) {
      toast({
        title: "Không thể xác nhận",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleQuickRemind(orderId: string) {
    setBusyOrderId(orderId);
    try {
      const res = await api.orders.remind(orderId);
      await navigator.clipboard?.writeText(res.message).catch(() => {});
      toast({ title: "Đã tạo & sao chép lời nhắc", description: res.message });
    } catch (err) {
      toast({
        title: "Không tạo được lời nhắc",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Báo cáo tổng kết phiên live
          </DialogTitle>
          <DialogDescription>
            Thống kê doanh thu, trạng thái đơn hàng và các đơn cần nhắc thanh toán.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tổng hợp số liệu...</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
        ) : summary ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-teal-50/50 p-4">
                <p className="text-xs text-muted-foreground">Doanh thu ghi nhận</p>
                <p className="mt-1 text-xl font-bold text-primary">{formatVnd(summary.revenue)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Đơn chờ xử lý</p>
                <p className="mt-1 text-xl font-bold">{summary.pendingOrders.length}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Trạng thái phiên</p>
                <p className="mt-1 text-base font-semibold">
                  {summary.session.status === "ended" ? "Đã kết thúc" : "Đang live"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {COUNT_STATUSES.map((st) => (
                <Badge key={st} variant={ORDER_STATUS_META[st].variant} className="px-3 py-1">
                  {ORDER_STATUS_META[st].label}: {summary.counts[st] ?? 0}
                </Badge>
              ))}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Sản phẩm bán chạy</h4>
              {summary.topProducts.length === 0 ? (
                <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                  Chưa có dữ liệu sản phẩm bán ra.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã</TableHead>
                      <TableHead>Tên sản phẩm</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.topProducts.map((tp) => (
                      <TableRow key={tp.productCode}>
                        <TableCell className="font-medium">{tp.productCode}</TableCell>
                        <TableCell>{tp.productName}</TableCell>
                        <TableCell className="text-right">{tp.qty}</TableCell>
                        <TableCell className="text-right font-medium">{formatVnd(tp.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">
                Đơn chưa hoàn tất thanh toán ({summary.pendingOrders.length})
              </h4>
              {summary.pendingOrders.length === 0 ? (
                <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                  Tất cả đơn hàng đã được xử lý xong.
                </p>
              ) : (
                <div className="space-y-2">
                  {summary.pendingOrders.map((o) => (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <span className="font-semibold">#{o.code}</span> — {o.buyer.displayName} (
                        {formatVnd(o.total)})
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyOrderId === o.id}
                          onClick={() => handleQuickRemind(o.id)}
                        >
                          <Bell className="h-3.5 w-3.5" /> Nhắc TT
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyOrderId === o.id}
                          onClick={() => handleQuickConfirm(o.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
