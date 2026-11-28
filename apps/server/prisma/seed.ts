import "dotenv/config";
import { readFileSync } from "node:fs";
import type { Product } from "@livemate/shared";
import { PrismaClient } from "@prisma/client";
import { PrismaBackendStore } from "../src/store/prisma-store.ts";

async function main() {
  const catalog: Product[] = JSON.parse(readFileSync(new URL("../fixtures/catalog.json", import.meta.url), "utf8"));
  const prisma = new PrismaClient();
  try {
    const store = new PrismaBackendStore(prisma);
    const { seller, session } = await store.ensureDemoSeed(catalog);
    await store.buyerHistory.recordOutcome("u_boom", "boomed").catch(() => {});
    console.log(`Seeded seller=${seller.email} room=${session.roomCode} (${session.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
