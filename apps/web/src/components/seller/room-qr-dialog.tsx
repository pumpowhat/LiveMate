"use client";

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface RoomQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomCode: string;
}

export function RoomQrDialog({ open, onOpenChange, roomCode }: RoomQrDialogProps) {
  const [copied, setCopied] = React.useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const roomUrl = `${origin}/r/${encodeURIComponent(roomCode)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mã QR phòng live {roomCode}</DialogTitle>
          <DialogDescription>
            Khách hàng quét mã này trên điện thoại để vào phòng dự phòng, xem món đang ghim và nhận link đơn.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <QRCodeSVG value={roomUrl} size={196} level="M" />
          </div>
          <div className="flex w-full gap-2">
            <Input readOnly value={roomUrl} aria-label="Liên kết phòng live" />
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
