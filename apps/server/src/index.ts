import "dotenv/config";
import { readFileSync } from "node:fs";
import type { Product } from "@livemate/shared";
import { createApp } from "./app.ts";
import { primaryLlmFromEnv } from "./pipeline/llm.ts";

const env = process.env;
const catalog: Product[] = JSON.parse(readFileSync(new URL("../fixtures/catalog.json", import.meta.url), "utf8"));

const { httpServer } = createApp({
  llm: primaryLlmFromEnv(env),
  catalog,
  webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
  publicWebUrl: env.PUBLIC_WEB_URL ?? "http://localhost:3000",
  vietqr: env.VIETQR_BANK_BIN && env.VIETQR_ACCOUNT_NUMBER ? { bankBin: env.VIETQR_BANK_BIN, accountNumber: env.VIETQR_ACCOUNT_NUMBER } : null,
  buyerHistorySeed: { u_boom: { boomed: 2, completed: 1 } },
  ...(env.INGEST_KEY ? { ingestKey: env.INGEST_KEY } : {}),
  devRoutes: env.NODE_ENV !== "production" || env.DEV_ROUTES === "1",
  // Gói miễn phí Gemini chỉ 15 request/phút: lô lớn (tới 40) để theo kịp khi live đông.
  pipeline: {
    batchWindowMs: Number(env.PIPELINE_BATCH_WINDOW_MS ?? 1500),
    maxBatchSize: Number(env.PIPELINE_MAX_BATCH ?? 40),
  },
  facebook: env.FB_GRAPH_VERSION
    ? {
        graphVersion: env.FB_GRAPH_VERSION,
        ...(env.FB_PAGE_TOKEN ? { pageToken: env.FB_PAGE_TOKEN } : {}),
        ...(env.FB_APP_ID && env.FB_APP_SECRET && env.FB_REDIRECT_URI
          ? { app: { appId: env.FB_APP_ID, appSecret: env.FB_APP_SECRET, redirectUri: env.FB_REDIRECT_URI } }
          : {}),
      }
    : null,
});

const port = Number(env.PORT ?? 4000);
httpServer.listen(port, () => console.log(`LiveMate server: http://localhost:${port} (phòng DEMO)`));
