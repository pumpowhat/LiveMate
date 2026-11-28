"use client";

import * as React from "react";
import { AlertTriangle, MessageSquare, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, RISK_KIND_LABELS, VERDICT_META } from "@/lib/format";
import type { Comment, CommentVerdict, ReplyEvent, RiskAlert } from "@/lib/types";

interface LiveFeedColumnProps {
  comments: Comment[];
  verdicts: Record<string, { verdict: CommentVerdict; orderId?: string }>;
  replies: ReplyEvent[];
  alerts: RiskAlert[];
}

export function LiveFeedColumn({ comments, verdicts, replies, alerts }: LiveFeedColumnProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Bình luận &amp; Cảnh báo rủi ro</CardTitle>
            <p className="text-xs text-muted-foreground">
              {comments.length} bình luận • {alerts.length} cảnh báo
            </p>
          </div>
          {alerts.length > 0 && (
            <Badge variant="danger" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {alerts.length} rủi ro
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        {alerts.length > 0 && (
          <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
            {alerts.map((alert) => {
              const tone =
                alert.severity === "danger"
                  ? "border-rose-200 bg-rose-50 text-rose-900"
                  : alert.severity === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-sky-200 bg-sky-50 text-sky-900";
              return (
                <div key={alert.id} className={`rounded-lg border p-2.5 text-xs ${tone}`}>
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {RISK_KIND_LABELS[alert.kind] ?? alert.kind}
                    </span>
                    <span className="opacity-75">{formatTime(alert.createdAt)}</span>
                  </div>
                  <p className="mt-1">{alert.message}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1">
          {comments.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center">
              <MessageSquare className="h-7 w-7 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">Chưa có bình luận nào</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bình luận từ Fanpage hoặc phòng live dự phòng sẽ xuất hiện tại đây theo thời gian thực.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => {
                const verdictInfo = verdicts[c.id];
                const meta = verdictInfo ? VERDICT_META[verdictInfo.verdict] : null;
                const isMuted = verdictInfo?.verdict === "ignored";
                const linkedReplies = replies.filter((r) => r.commentId === c.id);

                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border p-3 text-sm transition ${
                      isMuted ? "border-dashed bg-muted/40 opacity-60" : "bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`truncate font-semibold ${isMuted ? "text-muted-foreground" : ""}`}>
                          {c.buyerName}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {c.source}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
                        <span className="text-[11px] text-muted-foreground">{formatTime(c.createdAt)}</span>
                      </div>
                    </div>
                    <p className={`mt-1 ${isMuted ? "text-muted-foreground" : "text-slate-700"}`}>{c.text}</p>
                    {linkedReplies.map((r, idx) => (
                      <div
                        key={`${c.id}-reply-${idx}`}
                        className="mt-2 flex items-start gap-1.5 rounded-md bg-teal-50/70 px-2.5 py-1.5 text-xs text-teal-900"
                      >
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
