/**
 * Smoke test toàn luồng với server đang chạy:
 *   LLM_PROVIDER=fake VIETQR_ACCOUNT_NUMBER=0123456789 pnpm --filter @livemate/server dev
 *   pnpm --filter @livemate/server exec tsx scripts/smoke.ts [http://localhost:4000]
 */
import { io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@livemate/shared";
import type { Socket } from "socket.io-client";

const base = process.argv[2] ?? "http://localhost:4000";
/** Thời gian chờ mỗi lô (ms). LLM thật cần ~5000. */
const WAIT = Number(process.env.SMOKE_WAIT_MS ?? 2500);
const seller: Socket<ServerToClientEvents, ClientToServerEvents> = io(base);
const buyer: Socket<ServerToClientEvents, ClientToServerEvents> = io(base);
const log = (tag: string) => (x: unknown) => console.log(tag.padEnd(16), JSON.stringify(x).slice(0, 160));

seller.on("comment:verdict", log("verdict"));
seller.on("order:created", (o) => console.log("order:created".padEnd(16), o.code, o.buyer.displayName, o.items.map((i) => `${i.qty}x${i.productCode}/${i.size}`).join(","), o.total));
seller.on("order:updated", (o) => console.log("order:updated".padEnd(16), o.code, o.status, o.items.map((i) => `${i.qty}x${i.productCode}/${i.size}`).join(","), o.total));
buyer.on("reply:new", log("reply"));
seller.on("risk:alert", (a) => console.log("risk:alert".padEnd(16), a.kind, a.severity, a.message));

seller.emit("room:join", { roomCode: "DEMO", asSeller: true });
buyer.emit("room:join", { roomCode: "DEMO" });

const say = (id: string, name: string, text: string) =>
  buyer.emit("comment:send", { roomCode: "DEMO", buyerExternalId: id, buyerName: name, text });

await new Promise((r) => setTimeout(r, 300));
say("u_lan", "Lan", "chốt V03 size M");
say("u_minh", "Minh", "đẹp quá shop ơi");
say("u_minh", "Minh", "e lấy 2c A01 L");
say("u_lan", "Lan", "à đổi sang L nha shop");
await new Promise((r) => setTimeout(r, WAIT));
say("u_minh", "Minh", "thôi hủy nha");
say("u_boom", "Khách boom", "chốt A02 size S");
say("u_hoa", "Hoa", "chốt V05 size L");
await new Promise((r) => setTimeout(r, WAIT));

const state = (await (await fetch(`${base}/api/dev/state`)).json()) as { orders: { code: string; status: string; publicToken: string; total: number }[] };
console.log("\norders:", state.orders.map((o) => `${o.code} ${o.status} ${o.total}`).join(" | "));
const live = state.orders.find((o) => o.status !== "cancelled");
if (live) {
  const res = await fetch(`${base}/api/orders/${live.publicToken}/qr.png`);
  console.log("qr.png:", res.status, res.headers.get("content-type"), (await res.arrayBuffer()).byteLength, "bytes");
}
seller.close();
buyer.close();
