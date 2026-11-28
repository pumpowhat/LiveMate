"use client";

import * as React from "react";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
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
import { formatVnd } from "@/lib/format";
import type { LiveSession, Product, ProductInput } from "@/lib/types";

interface CatalogColumnProps {
  session: LiveSession;
  catalog: Product[];
  onProductCreated: (product: Product) => void;
  onProductUpdated: (product: Product) => void;
  onProductDeleted: (productId: string) => void;
  onSessionUpdated: (session: LiveSession) => void;
}

function parseSizesAndStock(sizesText: string, stockText: string): { sizes: string[]; stock: Record<string, number> } {
  const sizes = sizesText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const stock: Record<string, number> = {};
  if (sizes.length === 0) {
    const qty = Number.parseInt(stockText.trim(), 10);
    stock[""] = Number.isFinite(qty) && qty >= 0 ? qty : 0;
    return { sizes: [], stock };
  }

  // Hỗ trợ dạng "S:10, M:8" hoặc một số chung "10"
  const parts = stockText.split(",").map((p) => p.trim()).filter(Boolean);
  const singleNumber = parts.length === 1 && !parts[0]?.includes(":") ? Number.parseInt(parts[0]!, 10) : NaN;

  if (Number.isFinite(singleNumber) && singleNumber >= 0) {
    for (const s of sizes) stock[s] = singleNumber;
    return { sizes, stock };
  }

  for (const s of sizes) stock[s] = 0;
  for (const part of parts) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (k && v !== undefined) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) stock[k] = n;
    }
  }
  return { sizes, stock };
}

function formatStockInput(product: Product): string {
  if (product.sizes.length === 0) return String(product.stock[""] ?? 0);
  return product.sizes.map((s) => `${s}:${product.stock[s] ?? 0}`).join(", ");
}

export function CatalogColumn({
  session,
  catalog,
  onProductCreated,
  onProductUpdated,
  onProductDeleted,
  onSessionUpdated,
}: CatalogColumnProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [sizesText, setSizesText] = React.useState("");
  const [stockText, setStockText] = React.useState("10");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const isEnded = session.status === "ended";

  function openCreate() {
    setEditing(null);
    setCode("");
    setName("");
    setPrice("");
    setSizesText("S, M, L");
    setStockText("S:10, M:10, L:10");
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setCode(p.code);
    setName(p.name);
    setPrice(String(p.price));
    setSizesText(p.sizes.join(", "));
    setStockText(formatStockInput(p));
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsedPrice = Number.parseInt(price.trim(), 10);
    if (!code.trim() || !name.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError("Vui lòng nhập mã, tên sản phẩm và giá hợp lệ.");
      return;
    }
    const { sizes, stock } = parseSizesAndStock(sizesText, stockText);
    const payload: ProductInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      price: parsedPrice,
      sizes,
      stock,
    };

    setSaving(true);
    try {
      if (editing) {
        const res = await api.products.update(session.id, editing.id, payload);
        onProductUpdated(res.product);
        toast({ title: "Đã cập nhật sản phẩm", description: `${res.product.code} - ${res.product.name}`, variant: "success" });
      } else {
        const res = await api.products.create(session.id, payload);
        onProductCreated(res.product);
        toast({ title: "Đã thêm sản phẩm", description: `${res.product.code} - ${res.product.name}`, variant: "success" });
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Không thể lưu sản phẩm.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: Product) {
    setBusyId(p.id);
    try {
      await api.products.remove(session.id, p.id);
      onProductDeleted(p.id);
      toast({ title: "Đã xóa sản phẩm", description: p.code });
    } catch (err) {
      toast({
        title: "Không thể xóa sản phẩm",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleFeatured(p: Product) {
    const nextId = session.featuredProductId === p.id ? null : p.id;
    setBusyId(p.id);
    try {
      const res = await api.sessions.setFeatured(session.id, nextId);
      onSessionUpdated(res.session);
      toast({
        title: nextId ? `Đã ghim ${p.code}` : "Đã bỏ ghim sản phẩm",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Không thể cập nhật món ghim",
        description: err instanceof ApiError ? err.message : "Đã có lỗi xảy ra.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-3.5">
        <div>
          <CardTitle className="text-base">Sản phẩm &amp; Ghim món</CardTitle>
          <p className="text-xs text-muted-foreground">{catalog.length} món trong phiên</p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={isEnded}>
          <Plus className="h-4 w-4" />
          Thêm món
        </Button>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-3">
        {catalog.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center p-4">
            <p className="text-sm font-medium">Chưa có sản phẩm nào</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Thêm mã sản phẩm (VD: V03) để AI và khách hàng chốt đơn chính xác.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {catalog.map((p) => {
              const isFeatured = session.featuredProductId === p.id;
              const totalStock = Object.values(p.stock).reduce((a, b) => a + b, 0);
              return (
                <div
                  key={p.id}
                  className={`rounded-lg border p-3 transition ${
                    isFeatured ? "border-primary bg-teal-50/40" : "bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={isFeatured ? "default" : "secondary"}>{p.code}</Badge>
                        {isFeatured && <Badge variant="success">Đang ghim</Badge>}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-sm font-medium text-primary">{formatVnd(p.price)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="icon"
                        variant={isFeatured ? "default" : "outline"}
                        className="h-8 w-8"
                        onClick={() => handleToggleFeatured(p)}
                        disabled={isEnded || busyId === p.id}
                        title={isFeatured ? "Bỏ ghim" : "Ghim lên phòng live"}
                        aria-label={isFeatured ? "Bỏ ghim sản phẩm" : "Ghim sản phẩm"}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => openEdit(p)}
                        disabled={isEnded || busyId === p.id}
                        title="Sửa sản phẩm"
                        aria-label="Sửa sản phẩm"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(p)}
                        disabled={isEnded || busyId === p.id}
                        title="Xóa sản phẩm"
                        aria-label="Xóa sản phẩm"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <span>Tồn: {totalStock}</span>
                    {p.sizes.length > 0 && (
                      <span>
                        • Size: {p.sizes.map((s) => `${s}(${p.stock[s] ?? 0})`).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Sửa sản phẩm ${editing.code}` : "Thêm sản phẩm mới"}</DialogTitle>
            <DialogDescription>
              Nhập mã ngắn (VD: V03), giá bán VND và tồn kho theo từng size.
            </DialogDescription>
          </DialogHeader>
          <Form onSubmit={handleSave}>
            <div className="grid grid-cols-2 gap-3">
              <FormField>
                <FormLabel htmlFor="prod-code">Mã sản phẩm</FormLabel>
                <Input
                  id="prod-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="V03"
                  required
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="prod-price">Giá (VND)</FormLabel>
                <Input
                  id="prod-price"
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="250000"
                  required
                />
              </FormField>
            </div>
            <FormField>
              <FormLabel htmlFor="prod-name">Tên sản phẩm</FormLabel>
              <Input
                id="prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Váy hoa nhí dáng xòe"
                required
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="prod-sizes">Danh sách size (để trống nếu freesize)</FormLabel>
              <Input
                id="prod-sizes"
                value={sizesText}
                onChange={(e) => setSizesText(e.target.value)}
                placeholder="S, M, L"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="prod-stock">Tồn kho (VD: S:10, M:8 hoặc 10)</FormLabel>
              <Input
                id="prod-stock"
                value={stockText}
                onChange={(e) => setStockText(e.target.value)}
                placeholder="S:10, M:10, L:10"
              />
            </FormField>
            <FormMessage>{formError}</FormMessage>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu sản phẩm"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
