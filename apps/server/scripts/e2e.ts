/**
 * Kiểm tra đầu-cuối trên bản đã deploy, theo luồng thật (không dùng route dev):
 *   pnpm --filter @livemate/server exec tsx scripts/e2e.ts <WEB_URL> <SERVER_URL>
 *   ví dụ: tsx scripts/e2e.ts https://livemate.vercel.app https://server-xxx.up.railway.app
 *
 * Tự đăng ký một người bán dùng một lần + tạo phiên live riêng (có danh mục mẫu), nên không đụng
 * vào phòng DEMO. REST đi qua WEB_URL (kiểm tra luôn proxy /api của Next), Socket.IO nối thẳng
 * SERVER_URL với header Origin của web (kiểm tra CORS). Kết thúc phiên ở cuối để không để rác.
 */
import { randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, Order, ServerToClientEvents } from "@livemate/shared";

const web = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const server = (process.argv[3] ?? "http://localhost:4000").replace(/\/+$/, "");
/** Chờ tối đa cho mỗi đợt bình luận (LLM thật + gói miễn phí có thể mất vài giây). */
const WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 30_000);

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures.push(label);
};

let cookie = "";
async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${web}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: res.status, data: data as T };
}

function connect(auth?: { token: string }): Sock {
  return io(server, { auth, transports: ["websocket"], extraHeaders: { Origin: web } });
}

function emitAck(sock: Sock, event: "room:join" | "comment:send", payload: never): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => (sock.emit as (e: string, p: unknown, a: (r: { ok: boolean; error?: string }) => void) => void)(event, payload, resolve));
}

/** Chờ tới khi điều kiện đúng hoặc hết giờ. */
async function waitFor(cond: () => boolean, ms = WAIT_MS): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return cond();
}

const started = Date.now();
const email = `e2e-${randomBytes(4).toString("hex")}@livemate.test`;

// 1. Người bán: đăng ký, tạo phiên có danh mục mẫu.
const reg = await api<{ seller?: { id: string } }>("POST", "/auth/register", { email, password: randomBytes(12).toString("hex"), displayName: "E2E Shop" });
check(reg.status === 201 && !!cookie, `đăng ký người bán qua proxy Vercel (${reg.status})`);
const created = await api<{ session?: { id: string; roomCode: string } }>("POST", "/sessions", { seedCatalog: true });
const session = created.data.session;
check(created.status === 201 && !!session, `tạo phiên live (${created.status})`);
if (!session) throw new Error(`Không tạo được phiên: ${JSON.stringify(created.data)}`);

// 2. Socket người bán bằng socket-token.
const tok = await api<{ token: string }>("GET", "/auth/socket-token");
const seller = connect({ token: tok.data.token });
const orders = new Map<string, Order>();
const verdicts = new Map<string, string>();
const risks: string[] = [];
seller.on("order:created", (o) => orders.set(o.id, o as Order));
seller.on("order:updated", (o) => orders.set(o.id, o as Order));
seller.on("comment:verdict", (v) => verdicts.set(v.commentId, v.verdict));
seller.on("risk:alert", (a) => risks.push(a.kind));
const sellerJoin = await emitAck(seller, "room:join", { roomCode: session.roomCode, asSeller: true } as never);
check(sellerJoin.ok, `người bán vào phòng qua WebSocket${sellerJoin.ok ? "" : `: ${sellerJoin.error}`}`);

// 3. Hai người mua vào phòng bằng tên, nhận buyerToken.
async function buyer(name: string) {
  const join = await api<{ buyerToken: string }>("POST", `/rooms/${session!.roomCode}/join`, { displayName: name });
  const sock = connect();
  const replies: string[] = [];
  sock.on("reply:new", (r) => replies.push(r.text));
  const ack = await emitAck(sock, "room:join", { roomCode: session!.roomCode, buyerToken: join.data.buyerToken } as never);
  check(join.status === 200 && ack.ok, `người mua ${name} vào phòng`);
  const say = async (text: string) => {
    const r = await emitAck(sock, "comment:send", { roomCode: session!.roomCode, text, buyerToken: join.data.buyerToken } as never);
    if (!r.ok) check(false, `gửi bình luận "${text}": ${r.error}`);
  };
  return { sock, replies, say };
}
const lan = await buyer("Lan E2E");
const minh = await buyer("Minh E2E");

const items = (o: Order | undefined) => o?.items.map((i) => `${i.qty}x${i.productCode}${i.size ? `/${i.size}` : ""}`).join(",") ?? "-";
const orderOf = (name: string) => [...orders.values()].find((o) => o.buyer.displayName === name);

// 4. Đợt 1: chốt + khen (nhiễu) + chốt món khác.
const t1 = Date.now();
await lan.say("chốt V03 size M");
await minh.say("đẹp quá shop ơi");
await minh.say("e lấy 2 cái A01 size L");
await waitFor(() => !!orderOf("Lan E2E") && !!orderOf("Minh E2E"));
console.log(`  (đợt 1 xong sau ${((Date.now() - t1) / 1000).toFixed(1)} giây)`);
check(items(orderOf("Lan E2E")) === "1xV03/M", `AI tạo đơn Lan: ${items(orderOf("Lan E2E"))}`);
check(items(orderOf("Minh E2E")) === "2xA01/L", `AI tạo đơn Minh: ${items(orderOf("Minh E2E"))}`);
check([...verdicts.values()].includes("ignored"), "AI bỏ qua câu khen");

// 5. Đợt 2: sửa size + hủy đơn.
const t2 = Date.now();
await lan.say("à đổi sang L nha shop");
await minh.say("thôi em hủy nha");
await waitFor(() => items(orderOf("Lan E2E")) === "1xV03/L" && orderOf("Minh E2E")?.status === "cancelled");
console.log(`  (đợt 2 xong sau ${((Date.now() - t2) / 1000).toFixed(1)} giây)`);
check(items(orderOf("Lan E2E")) === "1xV03/L", `AI sửa size đơn Lan: ${items(orderOf("Lan E2E"))}`);
check(orderOf("Minh E2E")?.status === "cancelled", `AI hủy đơn Minh: ${orderOf("Minh E2E")?.status}`);

// 6. Trang đơn công khai của Lan + ảnh QR.
const lanOrder = orderOf("Lan E2E");
if (lanOrder) {
  const pub = await api<{ order?: Order }>("GET", `/orders/${lanOrder.publicToken}`);
  check(pub.status === 200 && pub.data.order?.total === lanOrder.total, `trang đơn công khai, tổng ${pub.data.order?.total}`);
  const buyerInfo = (pub.data.order?.buyer ?? {}) as Record<string, unknown>;
  console.log(`  trang đơn công khai lộ ID người mua: ${"externalId" in buyerInfo ? "CÓ (review mục 3 chưa sửa trên bản này)" : "không"}`);
  const qr = await fetch(`${web}/api/orders/${lanOrder.publicToken}/qr.png`);
  console.log(`  ảnh QR: HTTP ${qr.status}${qr.status === 200 ? "" : " (chưa đặt VIETQR_ACCOUNT_NUMBER thì đây là điều bình thường)"}`);
}

// 7. Kết thúc phiên, xem tổng kết.
const ended = await api<{ session?: { status: string } }>("POST", `/sessions/${session.id}/end`);
check(ended.data.session?.status === "ended", "kết thúc phiên live");
const summary = await api<{ summary?: { counts: Record<string, number> } } & { counts?: Record<string, number> }>("GET", `/sessions/${session.id}/summary`);
console.log(`  tổng kết: HTTP ${summary.status} ${JSON.stringify(summary.data.summary?.counts ?? summary.data.counts ?? summary.data).slice(0, 160)}`);
if (risks.length) console.log(`  cảnh báo rủi ro nhận được: ${risks.join(", ")}`);

for (const s of [seller, lan.sock, minh.sock]) s.close();
console.log(`\n${failures.length ? `✗ ${failures.length} bước lỗi` : "✓ Toàn bộ đạt"} — ${((Date.now() - started) / 1000).toFixed(1)} giây, phòng ${session.roomCode}, tài khoản ${email}`);
process.exit(failures.length ? 1 : 0);
