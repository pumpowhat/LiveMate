"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Clock, QrCode, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatVnd, ORDER_STATUS_META } from "@/lib/format";
import { createLiveMateSocket } from "@/lib/socket";
import type { PublicOrder } from "@/lib/types";

export default function PublicOrderPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token ?? "");

  const [order, setOrder] = React.useState<PublicOrder | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reporting, setReporting] = React.useState(false);
  const [qrError, setQrError] = React.useState(false);
  const [socketState, setSocketState] = React.useState<"connecting" | "connected" | "error">("connecting");

  const applyOrderIfNewer = React.useCallback((next: PublicOrder) => {
    setOrder((prev) => {
      if (!prev) return next;
      const prevTime = Date.parse(prev.updatedAt);
      const nextTime = Date.parse(next.updatedAt);
      if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime < prevTime) {
        return prev;
      }
      return next;
    });
  }, []);

  const loadOrder = React.useCallback(async (isBackground = false) => {
    try {
      const res = await api.orders.getPublic(token);
      applyOrderIfNewer(res.order);
      setError(null);
    } catch (err) {
      if (!isBackground) {
        setError(err instanceof ApiError ? err.message : "Không tìm thấy đơn hàng.");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [token, applyOrderIfNewer]);

  React.useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  React.useEffect(() => {
    if (!token) return;
    let disposed = false;
    const socket = createLiveMateSocket<PublicOrder>();

    const joinOrder = () => {
      socket.emit("order:join", { publicToken: token }, (ack) => {
        if (disposed) return;
        if (ack?.ok) {
          setSocketState("connected");
          void loadOrder(true);
        } else {
          setSocketState("error");
        }
      });
    };

    socket.on("connect", joinOrder);
    socket.on("connect_error", () => {
      if (!disposed) setSocketState("error");
    });
    socket.on("disconnect", () => {
      if (!disposed) setSocketState("connecting");
    });
    socket.on("order:updated", (updated) => {
      if (updated.publicToken === token) applyOrderIfNewer(updated);
    });
    socket.on("payment:confirmed", (updated) => {
      if (updated.publicToken === token) {
        applyOrderIfNewer(updated);
        toast({ title: "Shop đã xác nhận nhận được tiền!", variant: "success" });
      }
    });

    return () => {
      disposed = true;
      socket.disconnect();
    };
  }, [token, loadOrder, applyOrderIfNewer]);

  async function handleReportPayment() {
    if (!order) return;
    setReporting(true);
    try {
      const res = await api.orders.reportPayment(token, order.updatedAt);
      applyOrderIfNewer(res.order);
      toast({
        title: "Đã gửi báo cáo chuyển khoản",
        description: "Shop sẽ đối soát và xác nhận đơn của bạn sớm nhất.",
        variant: "success",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void loadOrder();
      toast({
        title: "Không thể báo đã chuyển khoản",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setReporting(false);
    }
  }

  const qrUrl = order
    ? `/api/orders/${encodeURIComponent(token)}/qr.png?v=${encodeURIComponent(`${order.updatedAt}-${order.total}`)}`
    : null;

  React.useEffect(() => {
    setQrError(false);
  }, [qrUrl]);

  if (loading && !order) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-muted-foreground">
        Đang tải thông tin đơn hàng...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Không tìm thấy đơn hàng</CardTitle>
            <CardDescription>{error ?? "Liên kết đơn hàng không hợp lệ hoặc đã hết hạn."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">Về trang chủ</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusMeta = ORDER_STATUS_META[order.status];
  const canPay = order.status === "pending_payment";
  const showPayableQr =
    order.total > 0 &&
    order.status !== "cancelled" &&
    order.status !== "paid" &&
    order.status !== "delivered";

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background p-3 py-5 sm:p-4 sm:py-6" data-socket-state={socketState}>
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-lg">Đơn hàng #{order.code}</CardTitle>
              <CardDescription className="break-words">
                Khách hàng: {order.buyer.displayName} • {formatDateTime(order.createdAt)}
              </CardDescription>
            </div>
            <Badge variant={statusMeta.variant} className="shrink-0">
              {statusMeta.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Chi tiết sản phẩm</h2>
            <ul className="divide-y rounded-lg border">
              {order.items.map((item, idx) => (
                <li key={`${item.productCode}-${item.size ?? "none"}-${idx}`} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {item.productCode} — {item.productName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.size ? `Size ${item.size} • ` : ""}Số lượng: {item.qty}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold">{formatVnd(item.unitPrice * item.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between rounded-lg bg-teal-50/60 px-3.5 py-2.5">
              <span className="text-sm font-semibold">Tổng thanh toán</span>
              <span className="text-lg font-bold text-primary">{formatVnd(order.total)}</span>
            </div>
          </div>

          {showPayableQr && qrUrl && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                <QrCode className="h-4 w-4 text-primary" />
                Mã VietQR chuyển khoản
              </div>

              {qrError ? (
                <div className="rounded-lg border border-dashed bg-background p-4 text-xs text-muted-foreground">
                  <ShieldAlert className="mx-auto mb-1.5 h-5 w-5 text-amber-600" />
                  Shop chưa cấu hình tài khoản VietQR trên máy chủ. Vui lòng chuyển khoản theo hướng dẫn của shop với nội dung{" "}
                  <strong className="text-foreground">{order.paymentReference}</strong>.
                </div>
              ) : (
                <div className="mx-auto inline-block rounded-xl border bg-white p-3 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrUrl}
                    alt={`Mã VietQR cho đơn ${order.code}`}
                    className="h-52 w-52 max-w-full object-contain"
                    onError={() => setQrError(true)}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Nội dung chuyển khoản: <strong className="text-foreground">{order.paymentReference}</strong>.
                <br />
                Trang này chỉ hiển thị mã QR đối soát, không tự động thực hiện thanh toán.
              </p>

              {canPay ? (
                <Button className="w-full" size="lg" onClick={handleReportPayment} disabled={reporting}>
                  {reporting ? "Đang gửi..." : "Tôi đã chuyển khoản"}
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  <Clock className="h-4 w-4" />
                  Bạn đã báo chuyển khoản. Vui lòng chờ shop đối soát.
                </div>
              )}
            </div>
          )}

          {(order.status === "paid" || order.status === "delivered") && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
              <CheckCircle2 className="h-5 w-5" />
              Đơn hàng đã được xác nhận thanh toán. Cảm ơn bạn!
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
