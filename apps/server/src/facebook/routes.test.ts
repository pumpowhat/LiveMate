import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { duplexPair } from "node:stream";
import { text } from "node:stream/consumers";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphClient } from "./graph.ts";
import type { FbPage } from "./oauth.ts";
import { createFacebookRouter } from "./routes.ts";
import { InMemoryFacebookConnectionStore } from "./store.ts";

const oauth = {
  appId: "test-app",
  appSecret: "test-secret",
  redirectUri: "https://api.livemate.example/api/facebook/callback",
  graphVersion: "v99.0",
};
const publicWebUrl = "https://livemate.example";
const sellerId = "seller-1";
const page = { id: "123", name: "Cửa hàng" };
const storedPage: FbPage = { ...page, accessToken: "page-token", tasks: ["MANAGE"] };

// Exercise Node's HTTP parsing and Express routing when the test sandbox forbids listening.
async function requestInProcess(server: Server, url: string, init: RequestInit) {
  const [clientSocket, serverSocket] = duplexPair();
  server.emit("connection", serverSocket);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = httpRequest(url, {
      method: init.method,
      headers: { ...Object.fromEntries(new Headers(init.headers)), connection: "close" },
      createConnection: () => clientSocket,
    }, resolve);
    req.on("error", reject);
    req.end(init.body);
  });
  const headers = new Headers();
  for (const [name, values] of Object.entries(response.headersDistinct)) {
    for (const value of values ?? []) headers.append(name, value);
  }
  return new Response(await text(response), { status: response.statusCode, headers });
}

describe("Facebook router", () => {
  let server: Server;
  let baseUrl: string;
  let store: InMemoryFacebookConnectionStore;
  const fetchImpl = vi.fn<typeof fetch>();
  const onWatch = vi.fn(async () => {});

  beforeEach(async () => {
    fetchImpl.mockReset();
    onWatch.mockClear();
    store = new InMemoryFacebookConnectionStore();
    const app = express();
    app.use("/api", createFacebookRouter({
      graph: new GraphClient({ graphVersion: oauth.graphVersion, fetchImpl }),
      oauth,
      store,
      publicWebUrl,
      resolveSellerId: (req) => req.get("X-Test-Seller") ?? null,
      onWatch,
      fetchImpl,
    }));
    server = createServer(app);
    try {
      const listening = once(server, "listening");
      server.listen(0, "127.0.0.1");
      await listening;
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      baseUrl = `http://127.0.0.1:${address.port}/api/facebook`;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
      baseUrl = "http://127.0.0.1/api/facebook";
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  function request(path: string, { seller = sellerId, body }: { seller?: string | null; body?: unknown } = {}) {
    const headers = new Headers();
    if (seller) headers.set("X-Test-Seller", seller);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const url = `${baseUrl}${path}`;
    const init = {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      redirect: "manual" as const,
    };
    return server.listening ? fetch(url, init) : requestInProcess(server, url, init);
  }

  async function loginState() {
    const response = await request("/login");
    const state = new URL(response.headers.get("Location")!).searchParams.get("state");
    if (!state) throw new Error("Expected OAuth state in the login URL");
    return state;
  }

  function connectPage() {
    store.save(sellerId, "user-token", [storedPage]);
    store.selectPage(sellerId, page.id);
  }

  it("redirects to Facebook with a fresh state and the configured OAuth parameters", async () => {
    const response = await request("/login");

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin).toBe("https://www.facebook.com");
    expect(location.pathname).toBe("/v99.0/dialog/oauth");
    expect(location.searchParams.get("client_id")).toBe(oauth.appId);
    expect(location.searchParams.get("redirect_uri")).toBe(oauth.redirectUri);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(await loginState()).not.toBe(location.searchParams.get("state"));
  });

  it("requires a seller to start login", async () => {
    const response = await request("/login", { seller: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("connects the seller and selects their only page after the OAuth callback", async () => {
    const state = await loginState();
    fetchImpl
      .mockResolvedValueOnce(Response.json({ access_token: "short-lived" }))
      .mockResolvedValueOnce(Response.json({ access_token: "long-lived" }))
      .mockResolvedValueOnce(Response.json({
        data: [{ ...page, access_token: storedPage.accessToken, tasks: storedPage.tasks }],
      }));

    const response = await request(`/callback?code=oauth-code&state=${state}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${publicWebUrl}/seller?facebook=connected`);
    expect(store.get(sellerId)).toMatchObject({ userToken: "long-lived", pages: [storedPage], selectedPageId: page.id });
    expect(await (await request("/status")).json()).toEqual({ connected: true, pages: [page], selectedPage: page });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((await request(`/callback?code=oauth-code&state=${state}`)).status).toBe(400);
  });

  it("rejects invalid or expired callback state before contacting Graph", async () => {
    expect((await request("/callback?code=oauth-code&state=invalid")).status).toBe(400);
    const state = await loginState();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000);

    expect((await request(`/callback?code=oauth-code&state=${state}`)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a callback presented by a different seller", async () => {
    const state = await loginState();
    const response = await request(`/callback?code=oauth-code&state=${state}`, { seller: "seller-2" });

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("redirects a denied login back to the seller page", async () => {
    const state = await loginState();
    const response = await request(`/callback?error=access_denied&state=${state}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${publicWebUrl}/seller?facebook=denied`);
    expect(store.get(sellerId)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hides tokens and limits status to the requesting seller", async () => {
    connectPage();

    expect(await (await request("/status")).json()).toEqual({ connected: true, pages: [page], selectedPage: page });
    expect(await (await request("/status", { seller: "seller-2" })).json()).toEqual({
      connected: false, pages: [], selectedPage: null,
    });
  });

  it("selects an authorized page and rejects an unknown page", async () => {
    const otherPage = { id: "456", name: "Trang thứ hai" };
    store.save(sellerId, "user-token", [storedPage, { ...otherPage, accessToken: "other-token", tasks: [] }]);

    const selected = await request("/pages/select", { body: { pageId: otherPage.id } });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toEqual({ selectedPage: otherPage });

    const missing = await request("/pages/select", { body: { pageId: "999" } });
    expect(missing.status).toBe(404);
    expect(await (await request("/status")).json()).toEqual({
      connected: true, pages: [page, otherPage], selectedPage: otherPage,
    });
  });

  it("lists the selected page's live videos with LIVE videos first", async () => {
    connectPage();
    const ended = { id: "1", status: "VOD" };
    const live = { id: "2", status: "LIVE" };
    const scheduled = { id: "3", status: "SCHEDULED_UNPUBLISHED" };
    fetchImpl.mockResolvedValueOnce(Response.json({ data: [ended, live, scheduled] }));

    const response = await request("/live-videos");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ videos: [live, ended, scheduled] });
    const graphUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(graphUrl.pathname).toBe(`/v99.0/${page.id}/live_videos`);
    expect(graphUrl.searchParams.get("access_token")).toBe(storedPage.accessToken);
  });

  it("requires a selected page for live videos and watch", async () => {
    store.save(sellerId, "user-token", [storedPage]);

    expect((await request("/live-videos")).status).toBe(409);
    expect((await request("/watch", { body: { objectId: "123_456" } })).status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onWatch).not.toHaveBeenCalled();
  });

  it("validates the watch object ID and passes the selected page token to onWatch", async () => {
    connectPage();

    expect((await request("/watch", { body: { objectId: "123/456" } })).status).toBe(400);
    expect((await request("/watch", { body: { objectId: 123 } })).status).toBe(400);
    expect(onWatch).not.toHaveBeenCalled();

    const response = await request("/watch", { body: { objectId: "123_456" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ watching: "123_456" });
    expect(onWatch).toHaveBeenCalledExactlyOnceWith({ sellerId, pageToken: storedPage.accessToken, objectId: "123_456" });
  });

  it.each([{ code: 190, status: 401 }, { code: 10, status: 502 }])(
    "maps Graph error $code to HTTP $status with a sanitized message",
    async ({ code, status }) => {
      connectPage();
      fetchImpl.mockResolvedValueOnce(Response.json({ error: { code, message: "Graph message with page-token" } }, { status: 400 }));

      const response = await request("/live-videos");

      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toEqual({ error: expect.any(String), ...(code === 190 ? { reconnect: true } : {}) });
      expect(body.error).not.toContain(storedPage.accessToken);
    },
  );

  it("disconnects the seller and clears their selected page", async () => {
    connectPage();
    const response = await request("/disconnect", { body: {} });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: false });
    expect(await (await request("/status")).json()).toEqual({ connected: false, pages: [], selectedPage: null });
  });
});
