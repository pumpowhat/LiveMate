"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Radio, ShieldCheck, Store, Users, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/format";
import { createLiveMateSocket } from "@/lib/socket";
import type { Comment } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = React.useState("DEMO");
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [socketState, setSocketState] = React.useState<"connecting" | "connected" | "error">("connecting");

  React.useEffect(() => {
    const socket = createLiveMateSocket();

    const joinDemo = () => {
      socket.emit("room:join", { roomCode: "DEMO" }, (ack) => {
        setSocketState(ack?.ok ? "connected" : "error");
      });
    };

    socket.on("connect", joinDemo);
    socket.on("connect_error", () => setSocketState("error"));
    socket.on("disconnect", () => setSocketState("connecting"));
    socket.on("comment:new", (comment) => {
      setComments((prev) => [comment, ...prev.filter((c) => c.id !== comment.id)].slice(0, 20));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = roomCode.trim().toUpperCase();
    if (!cleaned) return;
    router.push(`/r/${encodeURIComponent(cleaned)}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/60 via-background to-background">
      <header className="border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">LIVE MATE</p>
              <p className="text-xs text-muted-foreground">Trợ lý chốt đơn livestream</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/r/DEMO">Phòng DEMO</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/seller">Bảng điều khiển</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-12 lg:py-14">
        <section className="space-y-6 lg:col-span-7">
          <Badge variant="default" className="px-3 py-1">
            Chốt đơn tự động • Đối soát VietQR • Cảnh báo rủi ro
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Quản lý phiên live gọn gàng, không bỏ sót bình luận chốt đơn
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            LIVE MATE đồng bộ bình luận từ Fanpage và phòng live dự phòng theo thời gian thực,
            tự động phân loại chốt đơn, phát hiện rủi ro và tạo mã QR chuyển khoản riêng cho từng khách.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/seller">
                <Store className="h-4 w-4" />
                Vào trang người bán
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/r/DEMO">
                <Users className="h-4 w-4" />
                Mở phòng live DEMO
              </Link>
            </Button>
          </div>

          <Card className="max-w-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tham gia phòng live bằng mã</CardTitle>
              <CardDescription>Nhập mã phòng do người bán cung cấp (mặc định: DEMO).</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoinRoom} className="flex gap-2">
                <Input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="Ví dụ: DEMO"
                  aria-label="Mã phòng live"
                />
                <Button type="submit">Vào phòng</Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-3.5">
              <p className="text-sm font-semibold">3 cột trực quan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sản phẩm &amp; ghim món, luồng bình luận/rủi ro, và đơn hàng đối soát trên một màn hình.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3.5">
              <p className="text-sm font-semibold">VietQR từng đơn</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Khách mở link riêng để xem đơn, quét QR và báo đã chuyển khoản ngay trên điện thoại.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3.5">
              <p className="text-sm font-semibold">An toàn &amp; riêng tư</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Đơn hàng và mã người mua chỉ hiển thị cho đúng chủ đơn và người bán sở hữu phiên.
              </p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Luồng bình luận công khai (DEMO)</CardTitle>
                  <CardDescription>Chỉ nhận sự kiện công khai `comment:new`</CardDescription>
                </div>
                {socketState === "connected" ? (
                  <Badge variant="success" className="gap-1">
                    <Wifi className="h-3 w-3" /> Trực tiếp
                  </Badge>
                ) : socketState === "error" ? (
                  <Badge variant="danger" className="gap-1">
                    <WifiOff className="h-3 w-3" /> Mất kết nối
                  </Badge>
                ) : (
                  <Badge variant="warning">Đang kết nối...</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {comments.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
                  <ShieldCheck className="h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-medium">Chưa có bình luận mới</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    Mở <Link href="/r/DEMO" className="text-primary underline">/r/DEMO</Link> ở tab khác để thử gửi bình luận vào phòng mẫu.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{c.buyerName}</span>
                        <span className="text-[11px] text-muted-foreground">{formatTime(c.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-slate-700">{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
