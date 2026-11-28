import express from "express";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { AppError } from "../store/errors.ts";
import { GraphApiError } from "./graph.ts";
import type { GraphClient } from "./graph.ts";
import { buildLoginUrl, createFacebookOAuth, createStateStore } from "./oauth.ts";
import type { FbPage } from "./oauth.ts";
import type { FacebookConnectionStore } from "./store.ts";

const NO_SELECTED_PAGE = "Vui lòng chọn Fanpage trước.";

function publicPage({ id, name }: FbPage) {
  return { id, name };
}

export function createFacebookRouter(deps: {
  graph: GraphClient;
  oauth: { appId: string; appSecret: string; redirectUri: string; graphVersion: string };
  store: FacebookConnectionStore;
  publicWebUrl: string;
  resolveSellerId: (req: Request) => string | null | Promise<string | null>;
  onWatch: (args: { sellerId: string; pageToken: string; objectId: string; sessionId?: string }) => void | Promise<void>;
  onDisconnect?: (sellerId: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}): express.Router {
  const router = express.Router();
  const { store } = deps;
  const stateStore = createStateStore();
  const oauth = createFacebookOAuth({ ...deps.oauth, fetchImpl: deps.fetchImpl });
  const sellerUrl = `${deps.publicWebUrl.replace(/\/+$/, "")}/seller`;
  const json = express.json();

  function withSeller(handler: (req: Request, res: Response, sellerId: string) => void | Promise<void>): RequestHandler {
    return async (req, res) => {
      res.set("Cache-Control", "no-store");
      const sellerId = await deps.resolveSellerId(req);
      if (!sellerId) {
        res.status(401).json({ error: "Vui lòng đăng nhập để kết nối Fanpage." });
        return;
      }
      return handler(req, res, sellerId);
    };
  }

  router.get("/facebook/login", withSeller((_req, res, sellerId) => {
    const state = stateStore.issue(sellerId);
    res.redirect(302, buildLoginUrl({ ...deps.oauth, state }));
  }));

  router.get("/facebook/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    const { state, code, error } = req.query;
    const sellerId = typeof state === "string" ? stateStore.consume(state) : null;
    const currentSellerId = await deps.resolveSellerId(req);
    if (!sellerId || sellerId !== currentSellerId) {
      res.status(400).json({ error: "Phiên kết nối Facebook không hợp lệ hoặc đã hết hạn." });
      return;
    }
    if (error !== undefined) {
      res.redirect(302, `${sellerUrl}?facebook=denied`);
      return;
    }
    if (typeof code !== "string" || !code) {
      res.status(400).json({ error: "Thiếu mã xác thực Facebook." });
      return;
    }

    const shortLivedToken = await oauth.exchangeCode(code);
    const userToken = await oauth.toLongLived(shortLivedToken);
    const pages = await oauth.listPages(userToken);
    const [onlyPage] = pages;
    await store.save(sellerId, userToken, pages);
    if (pages.length === 1 && onlyPage) await store.selectPage(sellerId, onlyPage.id);

    res.redirect(302, `${sellerUrl}?facebook=connected`);
  });

  router.get("/facebook/status", withSeller(async (_req, res, sellerId) => {
    const connection = await store.get(sellerId);
    const selectedPage = await store.selectedPage(sellerId);
    res.json({
      connected: connection !== null,
      pages: connection?.pages.map(publicPage) ?? [],
      selectedPage: selectedPage ? publicPage(selectedPage) : null,
    });
  }));

  router.post("/facebook/pages/select", json, withSeller(async (req, res, sellerId) => {
    const { pageId }: { pageId?: unknown } = req.body ?? {};
    const selectedPage = typeof pageId === "string" ? await store.selectPage(sellerId, pageId) : null;
    if (!selectedPage) {
      res.status(404).json({ error: "Không tìm thấy Fanpage." });
      return;
    }
    res.json({ selectedPage: publicPage(selectedPage) });
  }));

  router.get("/facebook/live-videos", withSeller(async (_req, res, sellerId) => {
    const page = await store.selectedPage(sellerId);
    if (!page) {
      res.status(409).json({ error: NO_SELECTED_PAGE });
      return;
    }

    const videos = await deps.graph.getPageLiveVideos(page.id, page.accessToken);
    res.json({ videos: videos.toSorted((a, b) => Number(b.status === "LIVE") - Number(a.status === "LIVE")) });
  }));

  router.post("/facebook/watch", json, withSeller(async (req, res, sellerId) => {
    const { objectId, sessionId }: { objectId?: unknown; sessionId?: unknown } = req.body ?? {};
    if (typeof objectId !== "string" || !/^[\d_]+$/.test(objectId)) {
      res.status(400).json({ error: "ID video Facebook không hợp lệ." });
      return;
    }
    if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId.trim())) {
      res.status(400).json({ error: "sessionId không hợp lệ." });
      return;
    }
    const page = await store.selectedPage(sellerId);
    if (!page) {
      res.status(409).json({ error: NO_SELECTED_PAGE });
      return;
    }

    await deps.onWatch({
      sellerId,
      pageToken: page.accessToken,
      objectId,
      ...(typeof sessionId === "string" && sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    });
    res.json({ watching: objectId });
  }));

  router.post("/facebook/disconnect", withSeller(async (_req, res, sellerId) => {
    await store.disconnect(sellerId);
    await deps.onDisconnect?.(sellerId);
    res.json({ connected: false });
  }));

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof GraphApiError) {
      if (error.isTokenError) {
        res.status(401).json({ error: "Quyền truy cập Facebook đã hết hạn hoặc không hợp lệ. Vui lòng kết nối lại.", reconnect: true });
      } else {
        res.status(502).json({ error: "Facebook không thể xử lý yêu cầu. Vui lòng thử lại." });
      }
      return;
    }
    if (error instanceof Error && "status" in error && typeof error.status === "number" && [400, 413, 415].includes(error.status)) {
      res.status(error.status).json({ error: "Dữ liệu yêu cầu không hợp lệ." });
      return;
    }
    res.status(500).json({ error: "Không thể xử lý yêu cầu kết nối Fanpage." });
  };
  router.use(handleError);

  return router;
}
