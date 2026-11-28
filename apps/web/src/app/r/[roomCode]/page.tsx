"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ExternalLink,
  MessageCircle,
  Pin,
  Radio,
  Send,
  ShoppingBag,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import { formatTime, formatVnd, ORDER_STATUS_META } from "@/lib/format";
import { createLiveMateSocket, type LiveMateSocket } from "@/lib/socket";
import type { Comment, LiveSession, Order, Product, ReplyEvent } from "@/lib/types";

function storageKeys(roomCode: string) {
  return {
    token: `livemate_buyer_token_${roomCode}`,
    name: `livemate_buyer_name_${roomCode}`,
  };
}

export default function BuyerRoomPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = decodeURIComponent(params.roomCode ?? "DEMO");

  const [session, setSession] = React.useState<LiveSession | null>(null);
  const [featured, setFeatured] = React.useState<Product | null>(null);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [replies, setReplies] = React.useState<ReplyEvent[]>([]);
  const [ownOrder, setOwnOrder] = React.useState<Order | null>(null);

  const [buyerToken, setBuyerToken] = React.useState<string | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [joinedName, setJoinedName] = React.useState<string | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);
  const [commentText, setCommentText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [ownQrError, setOwnQrError] = React.useState(false);
  const [socketState, setSocketState] = React.useState<"connecting" | "connected" | "error">("connecting");

  const socketRef = React.useRef<LiveMateSocket | null>(null);
  const roomCodeRef = React.useRef(roomCode);
  const roomFetchSeqRef = React.useRef(0);
  const ownOrderSeqRef = React.useRef(0);
  const hasConnectedRef = React.useRef(false);

  roomCodeRef.current = roomCode;

  const applyOwnOrderIfNewer = React.useCallback((next: Order | null) => {
    if (!next) return;
    setOwnOrder((prev) => {
      if (!prev) return next;
      const prevTime = Date.parse(prev.updatedAt);
      const nextTime = Date.parse(next.updatedAt);
      if (Number.isFinite(prevTime) && Number.isFinite(nextTime) && nextTime < prevTime) {
        return prev;
      }
      return next;
    });
  }, []);

  const fetchRoomState = React.useCallback(async () => {
    const reqRoom = roomCode;
    const reqSeq = ++roomFetchSeqRef.current;
    try {
      const res = await api.rooms.get(reqRoom);
      if (roomCodeRef.current !== reqRoom || roomFetchSeqRef.current !== reqSeq) return;
      setSession(res.session);
      setFeatured(res.featuredProduct);
      setComments((prev) => {
        const byId = new Map<string, Comment>();
        for (const c of res.comments) byId.set(c.id, c);
        for (const c of prev) {
          if (c.sessionId === res.session.id && !byId.has(c.id)) {
            byId.set(c.id, c);
          }
        }
        return Array.from(byId.values())
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .slice(-100);
      });
      setLoadError(null);
    } catch (err) {
      if (roomCodeRef.current !== reqRoom || roomFetchSeqRef.current !== reqSeq) return;
      setLoadError(err instanceof ApiError ? err.message : "Không tìm thấy phòng live này.");
    } finally {
      if (roomCodeRef.current === reqRoom && roomFetchSeqRef.current === reqSeq) {
        setLoading(false);
      }
    }
  }, [roomCode]);

  const refetchOwnOrder = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    const reqRoom = roomCode;
    const keys = storageKeys(reqRoom);
    const savedToken = window.localStorage.getItem(keys.token) ?? buyerToken;
    const savedName = window.localStorage.getItem(keys.name) ?? joinedName;
    if (!savedToken || !savedName) return;

    const reqSeq = ++ownOrderSeqRef.current;
    try {
      const res = await api.rooms.join(reqRoom, {
        displayName: savedName,
        buyerToken: savedToken,
      });
      if (roomCodeRef.current !== reqRoom || ownOrderSeqRef.current !== reqSeq) return;
      window.localStorage.setItem(keys.token, res.buyerToken);
      setBuyerToken(res.buyerToken);
      setJoinedName(savedName);
      if (res.order) {
        applyOwnOrderIfNewer(res.order);
      }
    } catch {
      // Giữ token nếu lỗi mạng tạm thời
    }
  }, [roomCode, buyerToken, joinedName, applyOwnOrderIfNewer]);

  // Tải thông tin phòng + khôi phục buyerToken nếu đã lưu cho roomCode này
  React.useEffect(() => {
    let cancelled = false;
    hasConnectedRef.current = false;
    (async () => {
      await fetchRoomState();
      if (cancelled || typeof window === "undefined") return;
      const keys = storageKeys(roomCode);
      const savedToken = window.localStorage.getItem(keys.token);
      const savedName = window.localStorage.getItem(keys.name);
      if (savedToken && savedName) {
        const reqSeq = ++ownOrderSeqRef.current;
        try {
          const res = await api.rooms.join(roomCode, {
            displayName: savedName,
            buyerToken: savedToken,
          });
          if (!cancelled && roomCodeRef.current === roomCode && ownOrderSeqRef.current === reqSeq) {
            window.localStorage.setItem(keys.token, res.buyerToken);
            setBuyerToken(res.buyerToken);
            setJoinedName(savedName);
            applyOwnOrderIfNewer(res.order);
          }
        } catch {
          if (!cancelled) window.localStorage.removeItem(keys.token);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode, fetchRoomState, applyOwnOrderIfNewer]);

  // Kết nối Socket.IO cho phòng live
  React.useEffect(() => {
    if (!session) return;
    let disposed = false;
    const socket = createLiveMateSocket();
    socketRef.current = socket;

    const joinRoom = () => {
      const isReconnect = hasConnectedRef.current;
      socket.emit(
        "room:join",
        {
          roomCode,
          ...(buyerToken ? { buyerToken } : {}),
        },
        (ack) => {
          if (disposed || roomCodeRef.current !== roomCode) return;
          if (ack?.ok) {
            hasConnectedRef.current = true;
            setSocketState("connected");
            if (isReconnect) {
              void fetchRoomState();
              void refetchOwnOrder();
            }
          } else {
            setSocketState("error");
          }
        },
      );
    };

    socket.on("connect", joinRoom);
    socket.on("connect_error", () => {
      if (!disposed) setSocketState("error");
    });
    socket.on("disconnect", () => {
      if (!disposed) setSocketState("connecting");
    });

    socket.on("comment:new", (comment) => {
      if (comment.sessionId !== session.id) return;
      setComments((prev) => [...prev.filter((c) => c.id !== comment.id), comment].slice(-100));
    });

    socket.on("reply:new", (reply) => {
      setReplies((prev) => [...prev, reply].slice(-100));
    });

    socket.on("product:featured", (payload) => {
      if (payload.sessionId === session.id) {
        setFeatured(payload.product);
      }
    });

    socket.on("session:updated", (updated) => {
      if (updated.id === session.id) setSession(updated);
    });

    socket.on("order:created", (order) => {
      if (order.sessionId !== session.id) return;
      applyOwnOrderIfNewer(order);
      toast({
        title: `Đã tạo đơn #${order.code}`,
        description: `Tổng: ${formatVnd(order.total)}`,
        variant: "success",
      });
    });

    socket.on("order:updated", (order) => {
      if (order.sessionId !== session.id) return;
      applyOwnOrderIfNewer(order);
    });

    socket.on("payment:confirmed", (order) => {
      if (order.sessionId !== session.id) return;
      applyOwnOrderIfNewer(order);
      toast({
        title: `Đơn #${order.code} đã xác nhận thanh toán`,
        variant: "success",
      });
    });

    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.id, roomCode, buyerToken, fetchRoomState, refetchOwnOrder, applyOwnOrderIfNewer]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setJoining(true);
    try {
      const res = await api.rooms.join(roomCode, { displayName: name });
      const keys = storageKeys(roomCode);
      window.localStorage.setItem(keys.token, res.buyerToken);
      window.localStorage.setItem(keys.name, name);
      setBuyerToken(res.buyerToken);
      setJoinedName(name);
      setOwnOrder(res.order);
      toast({ title: `Chào ${name}!`, description: "Bạn có thể bình luận chốt đơn ngay.", variant: "success" });
    } catch (err) {
      toast({
        title: "Không thể tham gia phòng",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  }

  function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    const text = commentText.trim();
    if (!text || !socketRef.current || !buyerToken || sending) return;
    setSending(true);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setSending(false);
      toast({
        title: "Gửi bình luận quá thời gian",
        description: "Vui lòng kiểm tra kết nối và thử lại.",
        variant: "destructive",
      });
    }, 5000);

    socketRef.current.emit(
      "comment:send",
      { roomCode, text, source: "room", buyerToken },
      (ack) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setSending(false);
        if (!ack?.ok) {
          toast({
            title: "Không gửi được bình luận",
            description: ack?.error ?? "Vui lòng thử lại.",
            variant: "destructive",
          });
          return;
        }
        setCommentText("");
      },
    );
  }

  const ownOrderQrUrl = ownOrder
    ? `/api/orders/${encodeURIComponent(ownOrder.publicToken)}/qr.png?v=${encodeURIComponent(`${ownOrder.updatedAt}-${ownOrder.total}`)}`
    : null;

  React.useEffect(() => {
    setOwnQrError(false);
  }, [ownOrderQrUrl]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-muted-foreground">
        Đang tải phòng live {roomCode}...
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Không thể mở phòng live</CardTitle>
            <CardDescription>{loadError ?? "Phòng live không tồn tại."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">Quay về trang chủ</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isEnded = session.status === "ended";
  const showOwnQr =
    Boolean(ownOrder) &&
    ownOrder!.total > 0 &&
    (ownOrder!.status === "pending_payment" || ownOrder!.status === "awaiting_confirmation");

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/95 px-3 py-3 backdrop-blur-sm sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radio className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">Phòng live {session.roomCode}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {joinedName ? `Đang xem: ${joinedName}` : "Chế độ khách"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant={isEnded ? "secondary" : "success"}>
              {isEnded ? "Đã kết thúc" : "Đang live"}
            </Badge>
            {socketState === "connected" ? (
              <Wifi className="h-4 w-4 text-emerald-600" aria-label="Đã kết nối" />
            ) : (
              <WifiOff className="h-4 w-4 text-rose-500" aria-label="Mất kết nối" />
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3 pb-24">
        {featured && (
          <Card className="border-primary/40 bg-teal-50/40">
            <CardContent className="p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Pin className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-primary">Món đang ghim</span>
                    <Badge variant="default">{featured.code}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold">{featured.name}</p>
                  <p className="text-sm font-bold text-primary">{formatVnd(featured.price)}</p>
                  {featured.sizes.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Size: {featured.sizes.join(", ")}
                    </p>
                  )}
                </div>
                {buyerToken && !isEnded && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCommentText(
                        featured.sizes[0] ? `Chốt ${featured.code} ${featured.sizes[0]}` : `Chốt ${featured.code}`,
                      )
                    }
                  >
                    Chốt nhanh
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {ownOrder && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="space-y-3 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="text-sm font-bold">Đơn của bạn #{ownOrder.code}</span>
                    <Badge variant={ORDER_STATUS_META[ownOrder.status].variant}>
                      {ORDER_STATUS_META[ownOrder.status].label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ownOrder.items.length} món • {formatVnd(ownOrder.total)}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" asChild>
                  <Link href={`/o/${encodeURIComponent(ownOrder.publicToken)}`}>
                    Trang đơn <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>

              {showOwnQr && ownOrderQrUrl && (
                <div className="rounded-lg border bg-white p-3 text-center">
                  {ownQrError ? (
                    <p className="text-xs text-muted-foreground">
                      Chưa hiển thị được ảnh VietQR. Nội dung CK:{" "}
                      <strong className="text-foreground">LM {ownOrder.code}</strong>
                    </p>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ownOrderQrUrl}
                        alt={`Mã VietQR đơn ${ownOrder.code}`}
                        className="mx-auto h-44 w-44 max-w-full object-contain"
                        onError={() => setOwnQrError(true)}
                      />
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Nội dung CK: <strong className="text-foreground">LM {ownOrder.code}</strong>
                      </p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!buyerToken ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Nhập tên để bình luận chốt đơn</CardTitle>
              <CardDescription>
                Tên của bạn được dùng để tạo đơn hàng riêng tư trong phòng live này.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoin} className="flex gap-2">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ví dụ: Ngọc Lan"
                  required
                  aria-label="Tên hiển thị của bạn"
                />
                <Button type="submit" disabled={joining}>
                  {joining ? "Đang vào..." : "Tham gia"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card className="flex-1">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageCircle className="h-4 w-4 text-primary" />
              Bình luận trực tiếp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 p-3">
            {comments.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Chưa có bình luận nào. Hãy nhắn mã món + size (VD: &ldquo;V03 M&rdquo;) để chốt đơn!
              </p>
            ) : (
              comments.map((c) => {
                const linkedReplies = replies.filter((r) => r.commentId === c.id);
                return (
                  <div key={c.id} className="rounded-lg border bg-muted/20 p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.buyerName}</span>
                      <span className="text-[11px] text-muted-foreground">{formatTime(c.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 break-words text-slate-700">{c.text}</p>
                    {linkedReplies.map((r, idx) => (
                      <div
                        key={`${c.id}-r-${idx}`}
                        className="mt-1.5 flex items-start gap-1.5 rounded bg-teal-50 px-2 py-1 text-xs text-teal-900"
                      >
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </main>

      {buyerToken && (
        <footer className="fixed bottom-0 left-0 right-0 z-20 border-t bg-card/95 p-3 backdrop-blur-sm">
          <form onSubmit={handleSendComment} className="mx-auto flex max-w-lg gap-2">
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={isEnded ? "Phiên live đã kết thúc" : "Nhắn bình luận chốt đơn (VD: Chốt V03 M)..."}
              disabled={isEnded || sending}
              maxLength={500}
              aria-label="Nội dung bình luận"
            />
            <Button type="submit" disabled={isEnded || sending || !commentText.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </footer>
      )}
    </div>
  );
}
