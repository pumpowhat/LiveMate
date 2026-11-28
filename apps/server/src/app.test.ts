import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { duplexPair } from "node:stream";
import { text } from "node:stream/consumers";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClientToServerEvents, Comment, Order, Product, PublicOrder, Seller, ServerToClientEvents } from "@livemate/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { FakeRegexLlm } from "./pipeline/fake-llm.ts";

const catalog: Product[] = [
  { id: "p_v03", code: "V03", name: "Váy hoa nhí", sizes: ["S", "M", "L"], price: 250_000, stock: { S: 5, M: 5, L: 5 } },
  { id: "p_t01", code: "T01", name: "Túi tote", sizes: [], price: 120_000, stock: { "": 3 } },
];

async function requestInProcess(server: Server, url: string, init: RequestInit) {
  const [clientSocket, serverSocket] = duplexPair();
  server.emit("connection", serverSocket);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: init.method,
        headers: { ...Object.fromEntries(new Headers(init.headers)), connection: "close" },
        createConnection: () => clientSocket,
      },
      resolve,
    );
    req.on("error", reject);
    req.end(init.body);
  });
  const headers = new Headers();
  for (const [name, values] of Object.entries(response.headersDistinct)) {
    for (const value of values ?? []) headers.append(name, value);
  }
  return new Response(await text(response), { status: response.statusCode, headers });
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  ingest(res: Response) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const pair = entry.split(";")[0];
      if (!pair) continue;
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (!val) this.cookies.delete(name);
      else this.cookies.set(name, val);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

describe("LiveMate Server API & Realtime Isolation", () => {
  const servers: Server[] = [];

  async function boot(opts: { devRoutes?: boolean; vietqr?: { bankBin: string; accountNumber: string } | null } = {}) {
    const instance = createApp({
      llm: new FakeRegexLlm(),
      catalog,
      webOrigin: "http://localhost:3000",
      publicWebUrl: "http://localhost:3000",
      vietqr: opts.vietqr === undefined ? { bankBin: "970436", accountNumber: "0123456789" } : opts.vietqr,
      facebook: null,
      devRoutes: opts.devRoutes ?? false,
      buyerHistorySeed: { u_boom: { boomed: 2, completed: 0 } },
      pipeline: { batchWindowMs: 20, maxBatchSize: 10 },
      authSecret: "test-secret-key-32-chars-minimum",
    });
    await instance.ready;
    servers.push(instance.httpServer);

    let listening = false;
    let baseUrl = "http://127.0.0.1:4000";
    try {
      const waitListen = once(instance.httpServer, "listening");
      instance.httpServer.listen(0, "127.0.0.1");
      await waitListen;
      const addr = instance.httpServer.address();
      if (addr && typeof addr !== "string") {
        listening = true;
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
    } catch (err) {
      if (!(err instanceof Error) || !("code" in err) || err.code !== "EPERM") throw err;
    }

    const req = async (path: string, init: { method?: string; body?: unknown; jar?: CookieJar } = {}) => {
      const headers = new Headers();
      if (init.body !== undefined) headers.set("Content-Type", "application/json");
      if (init.jar?.header()) headers.set("Cookie", init.jar.header());
      const reqInit: RequestInit = {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      };
      const url = `${baseUrl}${path}`;
      const res = listening ? await fetch(url, reqInit) : await requestInProcess(instance.httpServer, url, reqInit);
      init.jar?.ingest(res);
      return res;
    };

    return { ...instance, listening, baseUrl, req };
  }

  afterEach(async () => {
    vi.useRealTimers();
    for (const s of servers.splice(0)) {
      if (s.listening) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  });

  it("supports seller auth, no-store GETs, short-lived socket-token without cookie leak, and two-seller isolation", async () => {
    const { req } = await boot({ devRoutes: false });

    // Dev routes are disabled in production mode.
    expect((await req("/api/dev/state")).status).toBe(404);
    expect((await req("/api/auth/me")).status).toBe(401);

    const jarA = new CookieJar();
    const regA = await req("/api/auth/register", {
      body: { email: "sellerA@example.com", password: "password123", displayName: "Shop A" },
      jar: jarA,
    });
    expect(regA.status).toBe(201);
    const { seller: sellerA } = (await regA.json()) as { seller: Seller };
    expect(sellerA).toEqual({ id: expect.any(String), email: "sellera@example.com", displayName: "Shop A" });

    const meRes = await req("/api/auth/me", { jar: jarA });
    expect(meRes.status).toBe(200);
    expect(meRes.headers.get("cache-control")).toBe("no-store");
    expect(await meRes.json()).toEqual({ seller: sellerA });

    const tokRes = await req("/api/auth/socket-token", { jar: jarA });
    expect(tokRes.status).toBe(200);
    const { token: socketToken } = (await tokRes.json()) as { token: string };
    expect(socketToken).toBeTruthy();
    expect(socketToken).not.toContain(jarA.get("livemate_session") ?? "impossible");

    // Create session with no body.
    const createSesRes = await req("/api/sessions", { method: "POST", jar: jarA });
    expect(createSesRes.status).toBe(201);
    const { session: sesA } = (await createSesRes.json()) as { session: { id: string; roomCode: string } };

    // Add product, update, feature it.
    const prodRes = await req(`/api/sessions/${sesA.id}/products`, {
      body: { code: "v03", name: "Váy A", sizes: ["S", "M"], price: 200_000, stock: { S: 2, M: 3 } },
      jar: jarA,
    });
    expect(prodRes.status).toBe(201);
    const { product } = (await prodRes.json()) as { product: Product };
    expect(product.code).toBe("V03");

    const featRes = await req(`/api/sessions/${sesA.id}/featured`, {
      method: "PUT",
      body: { productId: product.id },
      jar: jarA,
    });
    expect(featRes.status).toBe(200);
    expect(((await featRes.json()) as { session: { featuredProductId: string } }).session.featuredProductId).toBe(product.id);

    // Register Seller B and verify strict isolation on Seller A's session.
    const jarB = new CookieJar();
    const regB = await req("/api/auth/register", {
      body: { email: "sellerB@example.com", password: "password123" },
      jar: jarB,
    });
    expect(regB.status).toBe(201);

    expect((await req(`/api/sessions/${sesA.id}`, { jar: jarB })).status).toBe(403);
    expect((await req(`/api/sessions/${sesA.id}/summary`, { jar: jarB })).status).toBe(403);
    expect(
      (
        await req(`/api/sessions/${sesA.id}/products`, {
          body: { code: "X1", name: "X", sizes: [], price: 1000, stock: { "": 1 } },
          jar: jarB,
        })
      ).status,
    ).toBe(403);
    expect((await req(`/api/sessions/${sesA.id}/end`, { method: "POST", jar: jarB })).status).toBe(403);

    // Logout revokes cookie session.
    expect((await req("/api/auth/logout", { method: "POST", jar: jarA })).status).toBe(200);
    expect((await req("/api/auth/me", { jar: jarA })).status).toBe(401);
  });

  it("issues buyer capability, handles QR/state transitions/risk hooks, and isolates private order payloads over Socket.IO", async () => {
    const app = await boot({ devRoutes: false });
    const { req, listening, baseUrl, risk, store } = app;

    const jarSeller = new CookieJar();
    await req("/api/auth/register", {
      body: { email: "shop@example.com", password: "password123", displayName: "Shop" },
      jar: jarSeller,
    });
    const sesRes = await req("/api/sessions", { method: "POST", jar: jarSeller });
    const { session } = (await sesRes.json()) as { session: { id: string; roomCode: string } };
    const pRes = await req(`/api/sessions/${session.id}/products`, {
      body: { code: "V03", name: "Váy hoa", sizes: ["M", "L"], price: 250_000, stock: { M: 5, L: 2 } },
      jar: jarSeller,
    });
    const { product } = (await pRes.json()) as { product: Product };
    await req(`/api/sessions/${session.id}/featured`, { method: "PUT", body: { productId: product.id }, jar: jarSeller });

    // Buyer joins public room -> gets persisted buyerToken.
    const joinRes = await req(`/api/rooms/${session.roomCode}/join`, { body: { displayName: "Lan" } });
    expect(joinRes.status).toBe(200);
    const joinData = (await joinRes.json()) as { buyerToken: string; order: Order | null };
    expect(joinData.buyerToken).toBeTruthy();
    expect(joinData.order).toBeNull();

    // Public room snapshot never leaks orders or raw buyerExternalId.
    const publicRoomRes = await req(`/api/rooms/${session.roomCode}`);
    expect(publicRoomRes.status).toBe(200);
    expect(publicRoomRes.headers.get("cache-control")).toBe("no-store");
    const publicRoomJson = (await publicRoomRes.json()) as { session: unknown; featuredProduct: Product; comments: Comment[]; orders?: unknown };
    expect(publicRoomJson.orders).toBeUndefined();
    expect(publicRoomJson.featuredProduct.id).toBe(product.id);

    if (!listening) return;

    const { token: sellerToken } = (await (await req("/api/auth/socket-token", { jar: jarSeller })).json()) as { token: string };
    const sellerSock: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(baseUrl, {
      auth: { token: sellerToken },
      reconnection: false,
    });
    const buyerSock: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(baseUrl, { reconnection: false });
    const viewerSock: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(baseUrl, { reconnection: false });
    const publicOrderSock: Socket<ServerToClientEvents<PublicOrder>, ClientToServerEvents> = ioClient(baseUrl, { reconnection: false });

    try {
      await Promise.all(
        [sellerSock, buyerSock, viewerSock, publicOrderSock].map((socket) => new Promise<void>((resolve) => socket.once("connect", resolve))),
      );

      // Viewer cannot join as seller without seller token.
      const viewerSellerAck = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
        viewerSock.emit("room:join", { roomCode: session.roomCode, asSeller: true }, resolve),
      );
      expect(viewerSellerAck.ok).toBe(false);

      // Viewer joins public room only.
      const viewerAck = await new Promise<{ ok: boolean }>((resolve) =>
        viewerSock.emit("room:join", { roomCode: session.roomCode }, resolve),
      );
      expect(viewerAck.ok).toBe(true);

      // Viewer without buyerToken cannot send comments in production mode.
      const unauthCommentAck = await new Promise<{ ok: boolean }>((resolve) =>
        viewerSock.emit("comment:send", { roomCode: session.roomCode, buyerExternalId: "spoof", buyerName: "Spoof", text: "chốt V03 M" }, resolve),
      );
      expect(unauthCommentAck.ok).toBe(false);

      // Seller & authenticated buyer join.
      const sellerAck = await new Promise<{ ok: boolean }>((resolve) =>
        sellerSock.emit("room:join", { roomCode: session.roomCode, asSeller: true }, resolve),
      );
      const buyerAck = await new Promise<{ ok: boolean }>((resolve) =>
        buyerSock.emit("room:join", { roomCode: session.roomCode, buyerToken: joinData.buyerToken }, resolve),
      );
      expect(sellerAck.ok).toBe(true);
      expect(buyerAck.ok).toBe(true);

      const viewerOrders: Order[] = [];
      const viewerComments: Comment[] = [];
      viewerSock.on("order:created", (o) => viewerOrders.push(o));
      viewerSock.on("order:updated", (o) => viewerOrders.push(o));
      viewerSock.on("comment:new", (c) => viewerComments.push(c));

      const sellerOrderPromise = new Promise<Order>((resolve) => sellerSock.once("order:created", resolve));
      const buyerOrderPromise = new Promise<Order>((resolve) => buyerSock.once("order:created", resolve));

      const commentAck = await new Promise<{ ok: boolean }>((resolve) =>
        buyerSock.emit("comment:send", { roomCode: session.roomCode, text: "chốt V03 size M" }, resolve),
      );
      expect(commentAck.ok).toBe(true);

      const [sellerOrder, buyerOrder] = await Promise.all([sellerOrderPromise, buyerOrderPromise]);
      expect(sellerOrder.id).toBe(buyerOrder.id);
      expect(sellerOrder.total).toBe(250_000);

      // Public viewer received redacted comment and NEVER received raw Order.
      expect(viewerComments).toHaveLength(1);
      expect(viewerComments[0]!.buyerExternalId).toMatch(/^anon_/);
      expect(viewerComments[0]!.buyerExternalId).not.toBe(sellerOrder.buyer.externalId);
      expect(viewerOrders).toEqual([]);

      // Re-joining via HTTP with buyerToken returns buyer's own order.
      const rejoinRes = await req(`/api/rooms/${session.roomCode}/join`, { body: { buyerToken: joinData.buyerToken } });
      const rejoinData = (await rejoinRes.json()) as { buyerToken: string; order: Order | null };
      expect(rejoinData.order?.id).toBe(sellerOrder.id);

      const { publicToken } = sellerOrder;
      const orderPath = `/api/orders/${publicToken}`;
      const orderAck = await publicOrderSock.emitWithAck("order:join", { publicToken });
      expect(orderAck.ok).toBe(true);
      const publicOrder = (await (await req(orderPath)).json() as { order: PublicOrder }).order;
      expect(publicOrder.buyer).toEqual({ displayName: "Lan" });
      expect(publicOrder).not.toHaveProperty("sourceCommentIds");

      // QR endpoint returns valid PNG for unpaid order.
      const qrRes = await req(`/api/orders/${sellerOrder.publicToken}/qr.png`);
      expect(qrRes.status).toBe(200);
      expect(qrRes.headers.get("content-type")).toContain("image/png");

      // Payment report triggers risk hook & private payment:reported event.
      const onReportedSpy = vi.spyOn(risk, "onPaymentReported");
      const onConfirmedSpy = vi.spyOn(risk, "onPaymentConfirmed");
      const onClosedSpy = vi.spyOn(risk, "onOrderClosed");

      const reportedEv = new Promise<Order>((resolve) => sellerSock.once("payment:reported", resolve));
      const publicReportEv = new Promise<PublicOrder>((resolve) => publicOrderSock.once("payment:reported", resolve));
      const reportRes = await req(`${orderPath}/report-payment`, { body: { updatedAt: publicOrder.updatedAt } });
      expect(reportRes.status).toBe(200);
      const { order: reported } = (await reportRes.json()) as { order: PublicOrder };
      expect(reported.status).toBe("awaiting_confirmation");
      expect(reported.buyer).toEqual({ displayName: "Lan" });
      expect((await reportedEv).buyer.externalId).toBe(sellerOrder.buyer.externalId);
      expect(await publicReportEv).toEqual(reported);
      expect(onReportedSpy).toHaveBeenCalledTimes(1);
      expect(viewerOrders).toEqual([]);

      const updatedEv = new Promise<PublicOrder>((resolve) => publicOrderSock.once("order:updated", resolve));
      const patchRes = await req(`/api/sessions/${session.id}/orders/${sellerOrder.id}`, {
        method: "PATCH", jar: jarSeller,
        body: { line: { productId: product.id, size: "M" }, patch: { qty: 2 } },
      });
      expect(patchRes.status).toBe(200);
      const revised = await updatedEv;
      expect(revised).toMatchObject({ status: "pending_payment", total: 500_000 });
      expect(revised.buyer).toEqual({ displayName: "Lan" });
      const confirm = (updatedAt: string) => req(`/api/orders/${sellerOrder.id}/confirm`, { body: { updatedAt }, jar: jarSeller });
      expect((await confirm(revised.updatedAt)).status).toBe(409);
      expect((await req(`${orderPath}/report-payment`, { body: { updatedAt: publicOrder.updatedAt } })).status).toBe(409);
      expect((await publicOrderSock.emitWithAck("payment:report", { publicToken, updatedAt: publicOrder.updatedAt })).ok).toBe(false);
      expect(onReportedSpy).toHaveBeenCalledTimes(1);
      expect((await req(`${orderPath}/report-payment`, { body: { updatedAt: revised.updatedAt } })).status).toBe(200);
      const latest = (await (await req(orderPath)).json() as { order: PublicOrder }).order;
      expect((await confirm(reported.updatedAt)).status).toBe(409);

      // Seller confirms -> paid, cancels payment timer, emits payment:confirmed privately.
      const confirmedEv = new Promise<Order>((resolve) => buyerSock.once("payment:confirmed", resolve));
      const publicConfirmedEv = new Promise<PublicOrder>((resolve) => publicOrderSock.once("payment:confirmed", resolve));
      const confirmRes = await confirm(latest.updatedAt);
      expect(confirmRes.status).toBe(200);
      expect(((await confirmRes.json()) as { order: Order }).order.status).toBe("paid");
      await confirmedEv;
      expect((await publicConfirmedEv).buyer).toEqual({ displayName: "Lan" });
      expect(onConfirmedSpy).toHaveBeenCalledWith(sellerOrder.id);

      // Illegal transition: cannot cancel a paid order.
      expect((await req(`/api/orders/${sellerOrder.id}/cancel`, { method: "POST", jar: jarSeller })).status).toBe(409);

      // Deliver -> completed outcome recorded in BuyerHistory.
      const deliverRes = await req(`/api/orders/${sellerOrder.id}/deliver`, { method: "POST", jar: jarSeller });
      expect(deliverRes.status).toBe(200);
      expect(onClosedSpy).toHaveBeenCalledWith(expect.objectContaining({ id: sellerOrder.id }), "completed");
      await expect(store.buyerHistory.getStats(sellerOrder.buyer.externalId)).resolves.toEqual({ boomed: 0, completed: 1 });
    } finally {
      sellerSock.close();
      buyerSock.close();
      viewerSock.close();
      publicOrderSock.close();
    }
  });
});
