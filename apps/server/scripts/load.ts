/**
 * Load test against a running server with dev routes enabled.
 * pnpm --filter @livemate/server exec tsx scripts/load.ts
 */
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, CommentVerdict, Order, RiskAlert, ServerToClientEvents } from "@livemate/shared";
import { createCommentGenerator, seededRandom } from "./load-comments.ts";

type LoadSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SentComment = { text: string; sentAt: number };

const isOpen = (order: Order) => order.status === "pending_payment" || order.status === "awaiting_confirmation";

function readOptions() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:4000" },
      room: { type: "string", default: "DEMO" },
      buyers: { type: "string", default: "30" },
      duration: { type: "string", default: "60" },
      rate: { type: "string", default: "120" },
      seed: { type: "string", default: "1" },
    },
  });
  const positive = (flag: string, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`--${flag} must be a positive number`);
    return number;
  };
  const buyers = positive("buyers", values.buyers);
  const duration = positive("duration", values.duration);
  const rate = positive("rate", values.rate);
  const seed = Number(values.seed);
  if (!Number.isSafeInteger(buyers)) throw new Error("--buyers must be an integer");
  if (duration * 1000 > 2_147_483_647) throw new Error("--duration exceeds the Node.js timer limit");
  if (!values.seed.trim() || !Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");
  if (!values.room.trim()) throw new Error("--room must not be empty");
  const url = values.url.replace(/\/+$/, "");
  if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("--url must use HTTP or HTTPS");
  return { url, roomCode: values.room, buyers, duration, rate, seed };
}

function latencyStats(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(sorted[Math.ceil(sorted.length * p) - 1] ?? 0);
  return { p50: percentile(0.50), p95: percentile(0.95), max: percentile(1) };
}

function checkOrders(orders: Order[], buyerIds: ReadonlySet<string>) {
  const violations: string[] = [];
  const openOrders = new Map<string, string[]>();
  for (const order of orders) {
    const id = order.buyer.externalId;
    if (!buyerIds.has(id) || order.status === "cancelled") continue;
    const total = order.items.reduce((sum, { qty, unitPrice }) => sum + qty * unitPrice, 0);
    if (order.total !== total) violations.push(`Order ${order.code} (${id}) total ${order.total}, expected ${total}`);
    for (const item of order.items) {
      if (item.qty <= 0) violations.push(`Order ${order.code} (${id}) has qty ${item.qty} for ${item.productCode} ${item.size ?? ""}`);
    }
    if (isOpen(order)) {
      const codes = openOrders.get(id) ?? [];
      codes.push(order.code);
      openOrders.set(id, codes);
    }
  }
  for (const [id, codes] of openOrders) {
    if (codes.length > 1) violations.push(`${id} has ${codes.length} open orders (${codes.join(", ")})`);
  }
  return violations;
}

async function main() {
  const { url, roomCode, buyers: buyerCount, duration, rate, seed } = readOptions();
  const runId = Date.now().toString(36);
  const trafficRandom = seededRandom(seed);
  const generate = createCommentGenerator(seededRandom(seed ^ 0x9e3779b9));
  const shutdown = new AbortController();
  const { signal } = shutdown;
  const sockets: LoadSocket[] = [];
  const stop = (name: NodeJS.Signals) => shutdown.abort(new Error(`Load test interrupted by ${name}`));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  function makeSocket(name: string): LoadSocket {
    const socket: LoadSocket = io(url, { autoConnect: false, forceNew: true, reconnection: false, timeout: 10_000 });
    sockets.push(socket);
    socket.on("disconnect", (reason) => shutdown.abort(new Error(`${name} disconnected (${reason})`)));
    return socket;
  }

  function join(socket: LoadSocket, asSeller = false) {
    return new Promise<void>((resolve, reject) => {
      socket.once("connect_error", reject);
      socket.once("connect", () => {
        socket.off("connect_error", reject);
        socket.emit("room:join", { roomCode, asSeller });
        resolve();
      });
      socket.connect();
    });
  }

  async function devJson(path: string, method = "GET"): Promise<unknown> {
    const response = await fetch(`${url}/api/dev/${path}`, {
      method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`${method} /api/dev/${path} returned HTTP ${response.status}`);
    return response.json();
  }

  let progress: ReturnType<typeof setInterval> | undefined;
  try {
    await devJson("metrics/reset", "POST");
    const seller = makeSocket("Seller");
    const buyers = Array.from({ length: buyerCount }, (_, index) => {
      const i = index + 1;
      const name = `Khách ${i}`;
      return { id: `load_${runId}_${i}`, name, socket: makeSocket(name), fifo: [] as SentComment[], sentBefore: false };
    });
    const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));
    const buyerIds = new Set(buyerById.keys());
    const openOrderByBuyer = new Map<string, Order>();
    const sentAtByCommentId = new Map<string, number>();
    const verdicts: Record<Exclude<CommentVerdict, "queued">, number> = {
      ignored: 0, create: 0, update: 0, cancel: 0, ask: 0, unparsed: 0,
    };
    const latencies: number[] = [];
    const risks = new Map<RiskAlert["kind"], number>();
    let sent = 0;
    let created = 0;
    let updated = 0;
    let replies = 0;

    seller.on("comment:new", (comment) => {
      const fifo = buyerById.get(comment.buyerExternalId)?.fifo;
      if (!fifo) return;
      const index = fifo.findIndex((entry) => entry.text === comment.text);
      if (index === -1) return;
      const [entry] = fifo.splice(index, 1);
      sentAtByCommentId.set(comment.id, entry!.sentAt);
    });
    seller.on("comment:verdict", ({ commentId, verdict }) => {
      if (verdict === "queued") return;
      const sentAt = sentAtByCommentId.get(commentId);
      if (sentAt === undefined) return;
      sentAtByCommentId.delete(commentId);
      latencies.push(performance.now() - sentAt);
      verdicts[verdict]++;
    });
    function recordOrder(order: Order, isNew: boolean) {
      const id = order.buyer.externalId;
      if (!buyerIds.has(id)) return;
      if (isNew) created++;
      else updated++;
      if (isOpen(order)) openOrderByBuyer.set(id, order);
      else if (openOrderByBuyer.get(id)?.id === order.id) openOrderByBuyer.delete(id);
    }
    seller.on("order:created", (order) => recordOrder(order, true));
    seller.on("order:updated", (order) => recordOrder(order, false));
    seller.on("risk:alert", (alert) => {
      if (buyerIds.has(alert.buyerExternalId)) risks.set(alert.kind, (risks.get(alert.kind) ?? 0) + 1);
    });
    seller.on("reply:new", ({ buyerExternalId }) => {
      if (buyerIds.has(buyerExternalId)) replies++;
    });

    const interrupted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    // room:join has no acknowledgement. Send the seller join before connecting buyers.
    await Promise.race([join(seller, true).then(() => Promise.all(buyers.map(({ socket }) => join(socket)))), interrupted]);
    signal.throwIfAborted();

    console.log(`Run ${runId} in ${roomCode} with ${buyerCount} buyers, ${rate} comments/min for ${duration}s (seed ${seed})`);
    const pending = () => sent - latencies.length;
    progress = setInterval(() => {
      const { p50, p95 } = latencyStats(latencies);
      console.log(`sent=${sent} finalized=${latencies.length} pending=${pending()} p50=${p50}ms p95=${p95}ms ordersCreated=${created}`);
    }, 10_000);

    let nextSend = performance.now();
    const stopSendingAt = nextSend + duration * 1000;
    while (performance.now() < stopSendingAt) {
      nextSend += (-Math.log1p(-trafficRandom()) * 60_000) / rate;
      const wait = Math.min(nextSend, stopSendingAt) - performance.now();
      await sleep(Math.max(0, wait), undefined, { signal });
      if (nextSend >= stopSendingAt || performance.now() >= stopSendingAt) break;
      const buyer = buyers[Math.floor(trafficRandom() * buyers.length)]!;
      const text = generate(buyer.sentBefore, openOrderByBuyer.get(buyer.id)?.items ?? []);
      buyer.fifo.push({ text, sentAt: performance.now() });
      buyer.sentBefore = true;
      sent++;
      buyer.socket.emit("comment:send", { roomCode, buyerExternalId: buyer.id, buyerName: buyer.name, text });
    }

    const drainUntil = performance.now() + 30_000;
    while (pending() > 0 && performance.now() < drainUntil) {
      await sleep(Math.min(100, drainUntil - performance.now()), undefined, { signal });
    }
    clearInterval(progress);

    const neverFinalized = pending();
    const { p50, p95, max } = latencyStats(latencies);
    console.table({
      sent,
      finalized: latencies.length,
      "never-finalized": neverFinalized,
      ...verdicts,
      "latency p50 (ms)": p50,
      "latency p95 (ms)": p95,
      "latency max (ms)": max,
      "orders created": created,
      "orders updated": updated,
      replies,
      "risk alerts": [...risks.values()].reduce((sum, count) => sum + count, 0),
      ...Object.fromEntries([...risks].map(([kind, count]) => [`risk: ${kind}`, count])),
    });

    const [metrics, state] = await Promise.all([devJson("metrics"), devJson("state")]);
    console.log("Server metrics", JSON.stringify(metrics, null, 2));
    const violations = checkOrders((state as { orders: Order[] }).orders, buyerIds);
    console.log(`Consistency violations: ${violations.length}`);
    for (const violation of violations.slice(0, 5)) console.log(`- ${violation}`);

    if (neverFinalized > 0 || violations.length > 0 || verdicts.unparsed > 0.05 * sent) process.exitCode = 1;
  } catch (error) {
    throw signal.aborted ? signal.reason : error;
  } finally {
    clearInterval(progress);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    for (const socket of sockets) {
      socket.off("disconnect");
      socket.close();
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
