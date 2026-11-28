import "dotenv/config";
import { readFileSync } from "node:fs";
import type { Product } from "@livemate/shared";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.ts";
import { resolveAuthSecret, resolveDemoSeedConfig } from "./config/env.ts";
import { primaryLlmFromEnv } from "./pipeline/llm.ts";
import { MemoryBackendStore } from "./store/memory-store.ts";
import { PrismaBackendStore } from "./store/prisma-store.ts";
import type { BackendStore } from "./store/types.ts";

const env = process.env;
const isProduction = env.NODE_ENV === "production";
const catalog: Product[] = JSON.parse(readFileSync(new URL("../fixtures/catalog.json", import.meta.url), "utf8"));

if (isProduction && !env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required in production");
}
const authSecret = resolveAuthSecret(env);
resolveDemoSeedConfig(env);

let prisma: PrismaClient | null = null;
let store: BackendStore;

if (env.DATABASE_URL?.trim()) {
  prisma = new PrismaClient();
  await prisma.$connect();
  store = new PrismaBackendStore(prisma);
  // Seed default boom history for demo buyer if absent.
  const existingBoom = await prisma.buyerHistory.findUnique({ where: { buyerExternalId: "u_boom" } });
  if (!existingBoom) {
    await prisma.buyerHistory.create({
      data: { buyerExternalId: "u_boom", boomed: 2, completed: 1 },
    });
  }
} else {
  store = new MemoryBackendStore({
    buyerHistorySeed: { u_boom: { boomed: 2, completed: 1 } },
  });
}

const demoSeed = await store.ensureDemoSeed(catalog);

const { httpServer } = createApp({
  llm: primaryLlmFromEnv(env),
  catalog,
  store,
  demoSeed,
  webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
  publicWebUrl: env.PUBLIC_WEB_URL ?? "http://localhost:3000",
  vietqr: env.VIETQR_BANK_BIN && env.VIETQR_ACCOUNT_NUMBER ? { bankBin: env.VIETQR_BANK_BIN, accountNumber: env.VIETQR_ACCOUNT_NUMBER } : null,
  ...(env.INGEST_KEY ? { ingestKey: env.INGEST_KEY } : {}),
  ...(authSecret ? { authSecret } : {}),
  devRoutes: !isProduction || env.DEV_ROUTES === "1",
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
httpServer.listen(port, () => console.log(`LiveMate server: http://localhost:${port} (${prisma ? "PostgreSQL" : "in-memory"}, phòng DEMO)`));

if (prisma) {
  const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
