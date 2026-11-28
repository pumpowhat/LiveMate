"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Facebook,
  LogOut,
  Plus,
  QrCode,
  Radio,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import { createLiveMateSocket, type LiveMateSocket } from "@/lib/socket";
import type {
  Comment,
  CommentVerdict,
  LiveSession,
  Order,
  Product,
  ReplyEvent,
  RiskAlert,
  Seller,
} from "@/lib/types";
import { CatalogColumn } from "./catalog-column";
import { FanpageDialog } from "./fanpage-dialog";
import { LiveFeedColumn } from "./live-feed-column";
import { OrdersColumn } from "./orders-column";
import { RoomQrDialog } from "./room-qr-dialog";
import { SummaryDialog } from "./summary-dialog";

function mergeOrdersByUpdatedAt(prev: Order[], incoming: Order[], sessionId: string): Order[] {
  const byId = new Map<string, Order>();
  for (const o of incoming) {
    if (o.sessionId === sessionId) byId.set(o.id, o);
  }
  for (const o of prev) {
    if (o.sessionId !== sessionId) continue;
    const existing = byId.get(o.id);
    if (!existing) {
      byId.set(o.id, o);
      continue;
    }
    const prevTime = Date.parse(o.updatedAt);
    const nextTime = Date.parse(existing.updatedAt);
    if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && prevTime > nextTime) {
      byId.set(o.id, o);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

function mergeCommentsById(prev: Comment[], incoming: Comment[], sessionId: string): Comment[] {
  const byId = new Map<string, Comment>();
  for (const c of incoming) {
    if (c.sessionId === sessionId) byId.set(c.id, c);
  }
  for (const c of prev) {
    if (c.sessionId === sessionId && !byId.has(c.id)) {
      byId.set(c.id, c);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 200);
}

export function SellerDashboard() {
  const router = useRouter();
  const [seller, setSeller] = React.useState<Seller | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);

  const [sessions, setSessions] = React.useState<LiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null);
  const [activeSession, setActiveSession] = React.useState<LiveSession | null>(null);
  const [catalog, setCatalog] = React.useState<Product[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [verdicts, setVerdicts] = React.useState<Record<string, { verdict: CommentVerdict; orderId?: string }>>({});
  const [replies, setReplies] = React.useState<ReplyEvent[]>([]);
  const [alerts, setAlerts] = React.useState<RiskAlert[]>([]);

  const [loadingSession, setLoadingSession] = React.useState(false);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [socketState, setSocketState] = React.useState<"connecting" | "connected" | "error">("connecting");

  const [qrOpen, setQrOpen] = React.useState(false);
  const [fanpageOpen, setFanpageOpen] = React.useState(false);
  const [summaryOpen, setSummaryOpen] = React.useState(false);

  const socketRef = React.useRef<LiveMateSocket | null>(null);
  const selectedSessionIdRef = React.useRef<string | null>(null);
  const detailRequestSeqRef = React.useRef(0);
  const catalogRefreshTimerRef = React.useRef<number | null>(null);

  selectedSessionIdRef.current = selectedSessionId;
  const currentSession =
    activeSession && activeSession.id === selectedSessionId ? activeSession : null;

  // Kiểm tra query ?facebook=connected|denied sau OAuth callback
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fb = params.get("facebook");
    if (fb === "connected") {
      toast({ title: "Đã kết nối Fanpage thành công", variant: "success" });
      window.history.replaceState({}, "", "/seller");
    } else if (fb === "denied") {
      toast({ title: "Bạn đã hủy kết nối Fanpage", variant: "destructive" });
      window.history.replaceState({}, "", "/seller");
    }
  }, []);

  const loadSessions = React.useCallback(async () => {
    setSessionError(null);
    try {
      const res = await api.sessions.list();
      setSessions(res.sessions);
      const preferred =
        res.sessions.find((s) => s.status === "live") ?? res.sessions[0] ?? null;
      setSelectedSessionId((prev) =>
        prev && res.sessions.some((s) => s.id === prev) ? prev : preferred?.id ?? null,
      );
    } catch (err) {
      setSessionError(err instanceof ApiError ? err.message : "Không tải được danh sách phiên live.");
    }
  }, []);

  // Kiểm tra đăng nhập ban đầu; chuyển hướng về /seller/login nếu chưa đăng nhập
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.auth.me();
        if (!cancelled) {
          setSeller(res.seller);
          await loadSessions();
        }
      } catch {
        if (!cancelled) {
          setSeller(null);
          router.replace("/seller/login");
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions, router]);

  const loadSessionDetail = React.useCallback(
    async (sessionId: string, options?: { merge?: boolean }) => {
      const reqSeq = ++detailRequestSeqRef.current;
      if (!options?.merge) {
        setLoadingSession(true);
      }
      setSessionError(null);
      try {
        const detail = await api.sessions.get(sessionId);
        if (selectedSessionIdRef.current !== sessionId || detailRequestSeqRef.current !== reqSeq) {
          return;
        }
        if (options?.merge) {
          setActiveSession((prev) =>
            prev && prev.id === detail.session.id && prev.status === "ended"
              ? prev
              : detail.session,
          );
          setCatalog(detail.catalog);
          setOrders((prev) => mergeOrdersByUpdatedAt(prev, detail.orders, sessionId));
          setComments((prev) => mergeCommentsById(prev, detail.comments, sessionId));
        } else {
          setActiveSession(detail.session);
          setCatalog(detail.catalog);
          setOrders(detail.orders);
          setComments([...detail.comments].reverse());
        }
        setVerdicts((prev) => {
          const merged = options?.merge ? { ...prev } : {} as typeof prev;
          for (const { commentId, verdict, orderId } of detail.verdicts) {
            const current = merged[commentId];
            if (verdict === "queued" && current && current.verdict !== "queued") continue;
            merged[commentId] = { verdict, orderId };
          }
          return merged;
        });
        setAlerts((prev) => {
          const byId = new Map(detail.risks.map((alert) => [alert.id, alert]));
          if (options?.merge) {
            for (const alert of prev) byId.set(alert.id, alert);
          }
          return Array.from(byId.values())
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, 50);
        });
      } catch (err) {
        if (selectedSessionIdRef.current !== sessionId || detailRequestSeqRef.current !== reqSeq) {
          return;
        }
        setSessionError(err instanceof ApiError ? err.message : "Không tải được chi tiết phiên live.");
      } finally {
        if (!options?.merge && selectedSessionIdRef.current === sessionId && detailRequestSeqRef.current === reqSeq) {
          setLoadingSession(false);
        }
      }
    },
    [],
  );

  const scheduleCatalogRefresh = React.useCallback((sessionId: string) => {
    if (catalogRefreshTimerRef.current !== null) {
      window.clearTimeout(catalogRefreshTimerRef.current);
    }
    catalogRefreshTimerRef.current = window.setTimeout(async () => {
      catalogRefreshTimerRef.current = null;
      if (selectedSessionIdRef.current !== sessionId) return;
      try {
        const detail = await api.sessions.get(sessionId);
        if (selectedSessionIdRef.current === sessionId) {
          setCatalog(detail.catalog);
        }
      } catch {
        // Bỏ qua lỗi nền khi làm mới tồn kho
      }
    }, 400);
  }, []);

  React.useEffect(() => {
    setAlerts([]);
    setReplies([]);
    setVerdicts({});
    setComments([]);
    setOrders([]);
    setCatalog([]);
    setSocketState("connecting");
    if (catalogRefreshTimerRef.current !== null) {
      window.clearTimeout(catalogRefreshTimerRef.current);
      catalogRefreshTimerRef.current = null;
    }

    if (!seller || !selectedSessionId) {
      setActiveSession(null);
      return;
    }
    void loadSessionDetail(selectedSessionId);
  }, [seller, selectedSessionId, loadSessionDetail]);

  const upsertOrder = React.useCallback((next: Order) => {
    setOrders((prev) => {
      const exists = prev.some((o) => o.id === next.id);
      if (exists) {
        return prev.map((o) => {
          if (o.id !== next.id) return o;
          const prevTime = Date.parse(o.updatedAt);
          const nextTime = Date.parse(next.updatedAt);
          if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime < prevTime) {
            return o;
          }
          return next;
        });
      }
      return [next, ...prev];
    });
  }, []);

  const handleManualOrderUpdated = React.useCallback(
    (order: Order) => {
      if (selectedSessionIdRef.current !== order.sessionId) return;
      upsertOrder(order);
      scheduleCatalogRefresh(order.sessionId);
    },
    [upsertOrder, scheduleCatalogRefresh],
  );

  // Kết nối Socket.IO cho người bán với callback lấy fresh socket-token mỗi lần connect/reconnect
  React.useEffect(() => {
    if (!seller || !currentSession) return;
    let disposed = false;
    const roomCode = currentSession.roomCode;
    const sessionId = currentSession.id;

    const socket = createLiveMateSocket({ withSellerAuth: true });
    socketRef.current = socket;

    const joinSellerRoom = () => {
      socket.emit("room:join", { roomCode, asSeller: true }, (ack) => {
        if (disposed || selectedSessionIdRef.current !== sessionId) return;
        if (ack?.ok) {
          setSocketState("connected");
          void loadSessionDetail(sessionId, { merge: true });
        } else {
          setSocketState("error");
        }
      });
    };

    socket.on("connect", joinSellerRoom);
    socket.on("connect_error", () => {
      if (!disposed) setSocketState("error");
    });
    socket.on("disconnect", () => {
      if (!disposed) setSocketState("connecting");
    });

    socket.on("comment:new", (comment) => {
      if (comment.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      setComments((prev) => [comment, ...prev.filter((c) => c.id !== comment.id)].slice(0, 200));
    });

    socket.on("comment:verdict", (p) => {
      if (selectedSessionIdRef.current !== sessionId) return;
      setVerdicts((prev) => {
        const current = prev[p.commentId];
        if (p.verdict === "queued" && current && current.verdict !== "queued") return prev;
        return { ...prev, [p.commentId]: { verdict: p.verdict, orderId: p.orderId } };
      });
    });

    socket.on("reply:new", (reply) => {
      if (selectedSessionIdRef.current !== sessionId) return;
      setReplies((prev) => [...prev, reply].slice(-200));
    });

    socket.on("risk:alert", (alert) => {
      if (alert.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 50));
      toast({
        title: "Cảnh báo rủi ro mới",
        description: alert.message,
        variant: alert.severity === "danger" ? "destructive" : "default",
      });
    });

    socket.on("order:created", (order) => {
      if (order.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      upsertOrder(order);
      scheduleCatalogRefresh(sessionId);
    });

    socket.on("order:updated", (order) => {
      if (order.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      upsertOrder(order);
      scheduleCatalogRefresh(sessionId);
    });

    socket.on("payment:reported", (order) => {
      if (order.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      upsertOrder(order);
      toast({
        title: `Khách báo đã chuyển khoản (#${order.code})`,
        description: `${order.buyer.displayName} — vui lòng đối soát.`,
      });
    });

    socket.on("payment:confirmed", (order) => {
      if (order.sessionId !== sessionId || selectedSessionIdRef.current !== sessionId) return;
      upsertOrder(order);
    });

    socket.on("session:updated", (updated) => {
      if (updated.id === sessionId && selectedSessionIdRef.current === sessionId) {
        setActiveSession(updated);
      }
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    });

    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [seller, selectedSessionId, currentSession?.id, currentSession?.roomCode, loadSessionDetail, upsertOrder, scheduleCatalogRefresh]);

  async function handleCreateSession() {
    try {
      const res = await api.sessions.create();
      setSessions((prev) => [res.session, ...prev]);
      setSelectedSessionId(res.session.id);
      setAlerts([]);
      setReplies([]);
      setVerdicts({});
      toast({ title: "Đã tạo phiên live mới", description: `Mã phòng: ${res.session.roomCode}`, variant: "success" });
    } catch (err) {
      toast({
        title: "Không thể tạo phiên live",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    }
  }

  async function handleEndSession() {
    if (!currentSession) return;
    try {
      const res = await api.sessions.end(currentSession.id);
      if (selectedSessionIdRef.current === res.session.id) {
        setActiveSession(res.session);
        setSummaryOpen(true);
      }
      setSessions((prev) => prev.map((s) => (s.id === res.session.id ? res.session : s)));
      toast({ title: "Đã kết thúc phiên live", description: `Phòng ${res.session.roomCode}` });
    } catch (err) {
      toast({
        title: "Không thể kết thúc phiên",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    }
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
    } finally {
      socketRef.current?.disconnect();
      setSeller(null);
      setSessions([]);
      setActiveSession(null);
      router.replace("/seller/login");
    }
  }

  if (authLoading || !seller) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {authLoading ? "Đang kiểm tra phiên đăng nhập..." : "Đang chuyển hướng tới trang đăng nhập..."}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Radio className="h-4 w-4" />
              </span>
              <span>LIVE MATE</span>
            </Link>

            {sessions.length > 0 && (
              <select
                aria-label="Chọn phiên live"
                value={selectedSessionId ?? ""}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Phòng {s.roomCode} ({s.status === "live" ? "Đang live" : "Đã kết thúc"})
                  </option>
                ))}
              </select>
            )}

            <Button size="sm" variant="outline" onClick={handleCreateSession}>
              <Plus className="h-3.5 w-3.5" /> Phiên mới
            </Button>

            {currentSession && (
              <>
                <Button size="sm" variant="outline" onClick={() => setFanpageOpen(true)}>
                  <Facebook className="h-3.5 w-3.5 text-blue-600" /> Kết nối Fanpage
                </Button>
                <Button size="sm" variant="outline" onClick={() => setQrOpen(true)}>
                  <QrCode className="h-3.5 w-3.5" /> QR Phòng
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSummaryOpen(true)}>
                  <BarChart3 className="h-3.5 w-3.5" /> Báo cáo
                </Button>
                {currentSession.status === "live" && (
                  <Button size="sm" variant="destructive" onClick={handleEndSession}>
                    <Square className="h-3.5 w-3.5" /> Kết thúc live
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {currentSession && (
              socketState === "connected" ? (
                <Badge variant="success" className="gap-1">
                  <Wifi className="h-3 w-3" /> Trực tiếp
                </Badge>
              ) : socketState === "error" ? (
                <Badge variant="danger" className="gap-1">
                  <WifiOff className="h-3 w-3" /> Mất kết nối
                </Badge>
              ) : (
                <Badge variant="warning">Đang kết nối...</Badge>
              )
            )}
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {seller.displayName} ({seller.email})
            </span>
            <Button size="sm" variant="ghost" onClick={handleLogout} title="Đăng xuất">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 p-4">
        {sessionError && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {sessionError}
          </div>
        )}

        {!currentSession ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center">
            <Radio className="h-10 w-10 text-primary/70" />
            <h2 className="mt-3 text-lg font-semibold">
              {loadingSession ? "Đang tải phiên live..." : "Chưa có phiên live nào"}
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Tạo một phiên live mới để nhận mã phòng, thiết lập danh mục sản phẩm và bắt đầu chốt đơn tự động.
            </p>
            <Button className="mt-4" onClick={handleCreateSession}>
              <Plus className="h-4 w-4" /> Tạo phiên live đầu tiên
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:h-[calc(100vh-5.5rem)] lg:grid-cols-12">
            <div className="min-h-[420px] lg:col-span-4 lg:h-full">
              <LiveFeedColumn
                comments={comments}
                verdicts={verdicts}
                replies={replies}
                alerts={alerts}
              />
            </div>

            <div className="min-h-[420px] lg:col-span-4 lg:h-full">
              <OrdersColumn
                session={currentSession}
                catalog={catalog}
                orders={orders}
                onOrderUpdated={handleManualOrderUpdated}
              />
            </div>

            <div className="min-h-[420px] lg:col-span-4 lg:h-full">
              <CatalogColumn
                session={currentSession}
                catalog={catalog}
                onProductCreated={(p) => {
                  if (selectedSessionIdRef.current !== currentSession.id) return;
                  setCatalog((prev) => [...prev, p]);
                }}
                onProductUpdated={(p) => {
                  if (selectedSessionIdRef.current !== currentSession.id) return;
                  setCatalog((prev) => prev.map((item) => (item.id === p.id ? p : item)));
                }}
                onProductDeleted={(id) => {
                  if (selectedSessionIdRef.current !== currentSession.id) return;
                  setCatalog((prev) => prev.filter((item) => item.id !== id));
                }}
                onSessionUpdated={(s) => {
                  if (selectedSessionIdRef.current !== s.id) return;
                  setActiveSession(s);
                }}
              />
            </div>
          </div>
        )}
      </main>

      {currentSession && (
        <>
          <RoomQrDialog
            open={qrOpen}
            onOpenChange={setQrOpen}
            roomCode={currentSession.roomCode}
          />
          <FanpageDialog
            open={fanpageOpen}
            onOpenChange={setFanpageOpen}
            sessionId={currentSession.id}
            facebookObjectId={currentSession.facebookObjectId}
            onWatchStarted={(objectId) => {
              if (selectedSessionIdRef.current !== currentSession.id) return;
              setActiveSession((prev) => (prev ? { ...prev, facebookObjectId: objectId } : prev));
            }}
          />
          <SummaryDialog
            open={summaryOpen}
            onOpenChange={setSummaryOpen}
            sessionId={currentSession.id}
            onOrderUpdated={handleManualOrderUpdated}
          />
        </>
      )}
    </div>
  );
}
