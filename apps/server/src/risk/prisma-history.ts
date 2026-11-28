import type { PrismaClient } from "@prisma/client";
import type { BuyerHistoryStore } from "../risk/history.ts";

export class PrismaBuyerHistoryStore implements BuyerHistoryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getStats(buyerExternalId: string): Promise<{ boomed: number; completed: number }> {
    const row = await this.prisma.buyerHistory.findUnique({ where: { buyerExternalId } });
    return row ? { boomed: row.boomed, completed: row.completed } : { boomed: 0, completed: 0 };
  }

  async recordOutcome(buyerExternalId: string, outcome: "boomed" | "completed"): Promise<void> {
    await this.prisma.buyerHistory.upsert({
      where: { buyerExternalId },
      create: {
        buyerExternalId,
        boomed: outcome === "boomed" ? 1 : 0,
        completed: outcome === "completed" ? 1 : 0,
      },
      update: outcome === "boomed" ? { boomed: { increment: 1 } } : { completed: { increment: 1 } },
    });
  }
}
