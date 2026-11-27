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
  facebook: env.FB_GRAPH_VERSION && env.FB_PAGE_TOKEN ? { graphVersion: env.FB_GRAPH_VERSION, pageToken: env.FB_PAGE_TOKEN } : null,
});

const port = Number(env.PORT ?? 4000);
httpServer.listen(port, () => console.log(`LiveMate server: http://localhost:${port} (phòng DEMO)`));
