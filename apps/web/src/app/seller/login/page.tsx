"use client";

import { useRouter } from "next/navigation";
import { AuthPanel } from "@/components/seller/auth-panel";

export default function SellerLoginPage() {
  const router = useRouter();
  return <AuthPanel onSuccess={() => router.replace("/seller")} />;
}
