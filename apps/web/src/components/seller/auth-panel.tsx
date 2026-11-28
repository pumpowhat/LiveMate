"use client";

import * as React from "react";
import Link from "next/link";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormField, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { Seller } from "@/lib/types";

interface AuthPanelProps {
  onSuccess: (seller: Seller) => void;
}

export function AuthPanel({ onSuccess }: AuthPanelProps) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }
    setSubmitting(true);
    try {
      const res =
        mode === "login"
          ? await api.auth.login({ email: trimmedEmail, password })
          : await api.auth.register({
              email: trimmedEmail,
              password,
              ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            });
      onSuccess(res.seller);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể xác thực tài khoản.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-teal-50/50 via-background to-background px-4 py-10">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-xl">
              {mode === "login" ? "Đăng nhập người bán" : "Tạo tài khoản người bán"}
            </CardTitle>
            <CardDescription className="mt-1">
              Quản lý phiên live, danh mục sản phẩm và đối soát đơn hàng LIVE MATE.
            </CardDescription>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`rounded-md py-1.5 text-sm font-medium transition ${
                mode === "login" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`rounded-md py-1.5 text-sm font-medium transition ${
                mode === "register" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Đăng ký
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <Form onSubmit={handleSubmit}>
            {mode === "register" && (
              <FormField>
                <FormLabel htmlFor="seller-display-name">Tên cửa hàng / người bán</FormLabel>
                <Input
                  id="seller-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ví dụ: Shop Minh Anh"
                  autoComplete="name"
                />
              </FormField>
            )}
            <FormField>
              <FormLabel htmlFor="seller-email">Email</FormLabel>
              <Input
                id="seller-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="banhang@shop.vn"
                autoComplete="email"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="seller-password">Mật khẩu</FormLabel>
              <Input
                id="seller-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </FormField>

            <FormMessage>{error}</FormMessage>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? "Đang xử lý..."
                : mode === "login"
                  ? "Đăng nhập vào bảng điều khiển"
                  : "Đăng ký và bắt đầu"}
            </Button>

            <div className="pt-2 text-center text-xs text-muted-foreground">
              <Link href="/" className="hover:text-foreground hover:underline">
                ← Quay lại trang chủ
              </Link>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
