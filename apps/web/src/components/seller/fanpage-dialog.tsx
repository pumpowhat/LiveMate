"use client";

import * as React from "react";
import { Facebook, RefreshCw, Unplug, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { api, ApiError } from "@/lib/api";
import type { FacebookLiveVideo, FacebookStatusResponse } from "@/lib/types";

interface FanpageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  facebookObjectId: string | null;
  onWatchStarted: (objectId: string) => void;
}

export function FanpageDialog({
  open,
  onOpenChange,
  sessionId,
  facebookObjectId,
  onWatchStarted,
}: FanpageDialogProps) {
  const [status, setStatus] = React.useState<FacebookStatusResponse | null>(null);
  const [videos, setVideos] = React.useState<FacebookLiveVideo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingVideos, setLoadingVideos] = React.useState(false);
  const [watchingId, setWatchingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.facebook.status();
      setStatus(res);
      if (res.connected && res.selectedPage) {
        setLoadingVideos(true);
        try {
          const v = await api.facebook.liveVideos();
          setVideos(v.videos);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Không tải được danh sách live video.");
        } finally {
          setLoadingVideos(false);
        }
      } else {
        setVideos([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không kiểm tra được trạng thái Fanpage.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  async function handleSelectPage(pageId: string) {
    setError(null);
    try {
      await api.facebook.selectPage(pageId);
      toast({ title: "Đã chọn Fanpage", variant: "success" });
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không chọn được Fanpage.");
    }
  }

  async function handleWatch(objectId: string) {
    setWatchingId(objectId);
    setError(null);
    try {
      const res = await api.facebook.watch({ objectId, sessionId });
      onWatchStarted(res.watching);
      toast({ title: "Đang theo dõi bình luận Facebook", description: `Video ID: ${res.watching}`, variant: "success" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể theo dõi video này.");
    } finally {
      setWatchingId(null);
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await api.facebook.disconnect();
      setStatus({ connected: false, pages: [], selectedPage: null });
      setVideos([]);
      toast({ title: "Đã ngắt kết nối Fanpage" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể ngắt kết nối.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Facebook className="h-5 w-5 text-blue-600" />
            Kết nối Fanpage &amp; Theo dõi Livestream
          </DialogTitle>
          <DialogDescription>
            Đồng bộ bình luận trực tiếp từ Facebook Live Video vào phiên hiện tại.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Đang tải trạng thái Fanpage...</p>
        ) : !status?.connected ? (
          <div className="space-y-4 rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Bạn chưa kết nối tài khoản Facebook Fanpage. Nhấn nút bên dưới để cấp quyền đọc bình luận live.
            </p>
            <Button
              type="button"
              onClick={() => {
                window.location.href = "/api/facebook/login";
              }}
            >
              <Facebook className="h-4 w-4" /> Kết nối Fanpage ngay
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-xs text-muted-foreground">Fanpage đang chọn</p>
                <p className="text-sm font-semibold">
                  {status.selectedPage ? status.selectedPage.name : "Chưa chọn Fanpage"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={loadStatus}>
                  <RefreshCw className="h-3.5 w-3.5" /> Làm mới
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDisconnect}>
                  <Unplug className="h-3.5 w-3.5" /> Ngắt kết nối
                </Button>
              </div>
            </div>

            {status.pages.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Chọn Fanpage</p>
                <div className="flex flex-wrap gap-2">
                  {status.pages.map((page) => {
                    const active = status.selectedPage?.id === page.id;
                    return (
                      <Button
                        key={page.id}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => handleSelectPage(page.id)}
                      >
                        {page.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Video livestream gần đây</p>
              {loadingVideos ? (
                <p className="py-4 text-center text-xs text-muted-foreground">Đang tải danh sách video...</p>
              ) : videos.length === 0 ? (
                <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                  Không tìm thấy video live nào trên Fanpage này.
                </p>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                  {videos.map((v) => {
                    const isWatching = facebookObjectId === v.id;
                    return (
                      <div
                        key={v.id}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">
                              {v.title || v.description || `Video ${v.id}`}
                            </span>
                            <Badge variant={v.status === "LIVE" ? "danger" : "secondary"}>
                              {v.status}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">ID: {v.id}</p>
                        </div>
                        <Button
                          size="sm"
                          variant={isWatching ? "secondary" : "default"}
                          disabled={watchingId === v.id}
                          onClick={() => handleWatch(v.id)}
                        >
                          {isWatching ? "Đang theo dõi" : watchingId === v.id ? "Đang bật..." : "Theo dõi"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
