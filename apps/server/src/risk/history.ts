type BuyerStats = { boomed: number; completed: number };
type OrderOutcome = "boomed" | "completed";

export interface BuyerHistoryStore {
  getStats(buyerExternalId: string): Promise<BuyerStats>;
  recordOutcome(buyerExternalId: string, outcome: OrderOutcome): Promise<void>;
}

export class InMemoryBuyerHistoryStore implements BuyerHistoryStore {
  private readonly buyers = new Map<string, BuyerStats>();

  constructor(seed: Record<string, BuyerStats> = {}) {
    for (const [buyerExternalId, stats] of Object.entries(seed)) {
      this.buyers.set(buyerExternalId, { ...stats });
    }
  }

  async getStats(buyerExternalId: string): Promise<BuyerStats> {
    const stats = this.buyers.get(buyerExternalId);
    return stats ? { ...stats } : { boomed: 0, completed: 0 };
  }

  async recordOutcome(buyerExternalId: string, outcome: OrderOutcome): Promise<void> {
    const stats = this.buyers.get(buyerExternalId) ?? { boomed: 0, completed: 0 };
    stats[outcome] += 1;
    this.buyers.set(buyerExternalId, stats);
  }
}
