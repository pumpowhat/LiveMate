import { randomUUID } from "node:crypto";
import type { LiveSession, Product } from "@livemate/shared";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import type { BuyerRef } from "./gateway.ts";
import { PrismaOrderGateway } from "./prisma-gateway.ts";

interface DbProduct {
  id: string;
  sessionId: string;
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: Record<string, number>;
  createdAt: Date;
}

interface DbBuyer {
  id: string;
  sessionId: string;
  source: "facebook" | "room" | "extension";
  externalId: string;
  displayName: string;
}

interface DbOrderItem {
  id: string;
  orderId: string;
  productId: string;
  productCode: string;
  productName: string;
  size: string | null;
  qty: number;
  unitPrice: number;
  sortOrder: number;
}

interface DbOrder {
  id: string;
  code: string;
  sessionId: string;
  buyerId: string;
  status: "pending_payment" | "awaiting_confirmation" | "paid" | "delivered" | "cancelled";
  total: number;
  publicToken: string;
  sourceCommentIds: string[];
  sellerEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lightweight transactional mock implementing the PrismaClient subset used by PrismaOrderGateway,
 * verifying SQL locking, $transaction atomicity, and parity with InMemoryOrderGateway.
 */
function createMockPrisma(seed: { session: LiveSession; catalog: Product[]; previouslyFeatured?: string[] }) {
  const sessions = new Map([
    [
      seed.session.id,
      {
        id: seed.session.id,
        roomCode: seed.session.roomCode,
        sellerId: seed.session.sellerId ?? "seller_demo",
        status: seed.session.status,
        featuredProductId: seed.session.featuredProductId,
        previouslyFeatured: [...(seed.previouslyFeatured ?? [])],
        facebookObjectId: seed.session.facebookObjectId,
        facebookPageId: seed.session.facebookPageId ?? null,
        nextOrderSeq: 0,
        startedAt: new Date(seed.session.startedAt),
        endedAt: seed.session.endedAt ? new Date(seed.session.endedAt) : null,
      },
    ],
  ]);
  const products = new Map<string, DbProduct>(
    seed.catalog.map((p, idx) => [
      p.id,
      {
        id: p.id,
        sessionId: seed.session.id,
        code: p.code,
        name: p.name,
        sizes: [...p.sizes],
        price: p.price,
        stock: { ...p.stock },
        createdAt: new Date(Date.now() + idx),
      },
    ]),
  );
  const buyers = new Map<string, DbBuyer>();
  const orders = new Map<string, DbOrder>();
  const orderItems = new Map<string, DbOrderItem>();
  const queries: string[] = [];
  let txQueue = Promise.resolve();

  const buildTx = () => ({
    liveSession: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        if (!s) return null;
        return {
          ...s,
          products: [...products.values()]
            .filter((p) => p.sessionId === s.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.code.localeCompare(b.code)),
        };
      },
    },
    buyer: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { sessionId_externalId: { sessionId: string; externalId: string } };
        create: Omit<DbBuyer, "id">;
        update: { displayName: string };
      }) => {
        const existing = [...buyers.values()].find(
          (b) => b.sessionId === where.sessionId_externalId.sessionId && b.externalId === where.sessionId_externalId.externalId,
        );
        if (existing) {
          existing.displayName = update.displayName;
          return { ...existing };
        }
        const row: DbBuyer = { id: randomUUID(), ...create };
        buyers.set(row.id, row);
        return { ...row };
      },
    },
    product: {
      update: async ({ where, data }: { where: { id: string }; data: { stock: Record<string, number> } }) => {
        const row = products.get(where.id);
        if (!row) throw new Error(`Product ${where.id} not found`);
        row.stock = { ...data.stock };
        return { ...row };
      },
    },
    order: {
      findFirst: async ({
        where,
      }: {
        where: { sessionId: string; buyerId: string; status: { in: string[] } };
      }) => {
        const found = [...orders.values()].find(
          (o) => o.sessionId === where.sessionId && o.buyerId === where.buyerId && where.status.in.includes(o.status),
        );
        if (!found) return null;
        return {
          ...found,
          buyer: buyers.get(found.buyerId)!,
          items: [...orderItems.values()]
            .filter((i) => i.orderId === found.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = orders.get(where.id);
        if (!found) return null;
        return {
          ...found,
          buyer: buyers.get(found.buyerId)!,
          items: [...orderItems.values()]
            .filter((i) => i.orderId === found.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        };
      },
      findMany: async ({
        where,
      }: {
        where: { sessionId: string; status: { in: string[] }; buyer: { externalId: { in: string[] } } };
      }) => {
        const extSet = new Set(where.buyer.externalId.in);
        return [...orders.values()]
          .filter((o) => {
            const b = buyers.get(o.buyerId);
            return o.sessionId === where.sessionId && where.status.in.includes(o.status) && b && extSet.has(b.externalId);
          })
          .map((o) => ({
            ...o,
            buyer: buyers.get(o.buyerId)!,
            items: [...orderItems.values()]
              .filter((i) => i.orderId === o.id)
              .sort((a, b) => a.sortOrder - b.sortOrder),
          }));
      },
      create: async ({
        data,
      }: {
        data: Omit<DbOrder, "id" | "createdAt" | "updatedAt"> & {
          items: { create: Array<Omit<DbOrderItem, "id" | "orderId">> };
        };
      }) => {
        const now = new Date();
        const order: DbOrder = {
          id: randomUUID(),
          code: data.code,
          sessionId: data.sessionId,
          buyerId: data.buyerId,
          status: data.status,
          total: data.total,
          publicToken: data.publicToken,
          sourceCommentIds: [...data.sourceCommentIds],
          sellerEdited: data.sellerEdited,
          createdAt: now,
          updatedAt: now,
        };
        orders.set(order.id, order);
        const createdItems: DbOrderItem[] = [];
        for (const item of data.items.create) {
          const itemRow: DbOrderItem = { id: randomUUID(), orderId: order.id, ...item };
          orderItems.set(itemRow.id, itemRow);
          createdItems.push(itemRow);
        }
        return { ...order, buyer: buyers.get(order.buyerId)!, items: createdItems };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<DbOrder, "status" | "total" | "sourceCommentIds" | "updatedAt">>;
      }) => {
        const row = orders.get(where.id)!;
        Object.assign(row, data);
        return {
          ...row,
          buyer: buyers.get(row.buyerId)!,
          items: [...orderItems.values()]
            .filter((i) => i.orderId === row.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        };
      },
    },
    orderItem: {
      create: async ({ data }: { data: Omit<DbOrderItem, "id"> }) => {
        const row: DbOrderItem = { id: randomUUID(), ...data };
        orderItems.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<DbOrderItem> }) => {
        const row = orderItems.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        orderItems.delete(where.id);
      },
      findMany: async ({ where }: { where: { orderId: string } }) => {
        return [...orderItems.values()]
          .filter((i) => i.orderId === where.orderId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      queries.push(sql.trim());
      if (sql.includes('FROM "Product"')) {
        const productId = String(values[0]);
        const sessionId = String(values[1]);
        const p = products.get(productId);
        return p && p.sessionId === sessionId ? [{ ...p, stock: { ...p.stock } }] : [];
      }
      if (sql.includes('UPDATE "LiveSession"')) {
        const sessionId = String(values[0]);
        const s = sessions.get(sessionId);
        if (!s) return [];
        s.nextOrderSeq += 1;
        return [{ nextOrderSeq: s.nextOrderSeq }];
      }
      const id = String(values[0]);
      if (sql.includes('FROM "LiveSession"')) {
        return sessions.has(id) ? [{ id }] : [];
      }
      if (sql.includes('FROM "Order"') && sql.includes('"buyerId"')) {
        const buyerId = String(values[1]);
        const order = [...orders.values()].find((row) =>
          row.sessionId === id && row.buyerId === buyerId
          && (row.status === "pending_payment" || row.status === "awaiting_confirmation"),
        );
        return order ? [{ id: order.id }] : [];
      }
      if (sql.includes('FROM "Buyer"')) {
        return buyers.has(id) ? [{ id }] : [];
      }
      if (sql.includes('FROM "Order"')) {
        return orders.has(id) ? [{ id }] : [];
      }
      return [];
    },
  });

  const root = buildTx();
  const client = {
    ...root,
    $transaction: async <T>(fn: (tx: ReturnType<typeof buildTx>) => Promise<T>): Promise<T> => {
      const run = txQueue.then(async () => {
        // Snapshot for rollback on error
        const snapProducts = structuredClone([...products.entries()]);
        const snapBuyers = structuredClone([...buyers.entries()]);
        const snapOrders = structuredClone([...orders.entries()]);
        const snapItems = structuredClone([...orderItems.entries()]);
        const snapSessions = structuredClone([...sessions.entries()]);
        try {
          return await fn(buildTx());
        } catch (err) {
          products.clear();
          for (const [k, v] of snapProducts) products.set(k, v);
          buyers.clear();
          for (const [k, v] of snapBuyers) buyers.set(k, v);
          orders.clear();
          for (const [k, v] of snapOrders) orders.set(k, v);
          orderItems.clear();
          for (const [k, v] of snapItems) orderItems.set(k, v);
          sessions.clear();
          for (const [k, v] of snapSessions) sessions.set(k, v);
          throw err;
        }
      });
      txQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return { prisma: client as unknown as PrismaClient, queries, products };
}

const session: LiveSession = {
  id: "live",
  roomCode: "room",
  status: "live",
  featuredProductId: "dress",
  facebookObjectId: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
};
const buyer: BuyerRef = { externalId: "buyer", name: "Lan", source: "room" };
const dress = { productId: "dress", size: "M" };
const bag = { productId: "bag", size: null };

describe("PrismaOrderGateway", () => {
  let catalog: Product[];
  let gateway: PrismaOrderGateway;
  let queries: string[];
  let products: Map<string, DbProduct>;

  beforeEach(() => {
    catalog = [
      { id: "dress", code: "V03", name: "Dress", price: 250_000, sizes: ["M", "L"], stock: { M: 3, L: 1 } },
      { id: "bag", code: "T01", name: "Bag", price: 120_000, sizes: [], stock: { "": 2 } },
    ];
    const mock = createMockPrisma({ session, catalog, previouslyFeatured: ["A01"] });
    queries = mock.queries;
    products = mock.products;
    gateway = new PrismaOrderGateway(mock.prisma);
  });

  test("returns session context and rejects unknown sessions", async () => {
    expect(await gateway.getSessionContext(session.id)).toMatchObject({
      session: { id: "live", featuredProductId: "dress" },
      previouslyFeatured: ["A01"],
      catalog,
    });
    await expect(gateway.getSessionContext("unknown")).rejects.toThrow();
    await expect(gateway.getOpenOrders("unknown", [])).rejects.toThrow();
    await expect(gateway.addItem("unknown", buyer, { ...dress, qty: 1 }, "c1")).rejects.toThrow();
  });

  test("merges lines into one open order, uses FOR UPDATE locks, and prevents concurrent overselling", async () => {
    const first = await gateway.addItem(session.id, buyer, { ...dress, qty: 1 }, "c1");
    expect(first.code).toBe("A1");
    expect(first.publicToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(queries.some((q) => q.includes("FOR UPDATE"))).toBe(true);

    const second = await gateway.addItem(session.id, buyer, { ...dress, qty: 2 }, "c2");
    expect(second.id).toBe(first.id);
    expect(second.items[0]?.qty).toBe(3);
    expect(second.total).toBe(750_000);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(products.get("dress")?.stock.M).toBe(0);

    // Concurrent race for the last size L unit: one succeeds, one fails without overselling.
    const race = await Promise.allSettled([
      gateway.addItem(session.id, { externalId: "b2", name: "A", source: "room" }, { productId: "dress", size: "L", qty: 1 }, "c3"),
      gateway.addItem(session.id, { externalId: "b3", name: "B", source: "room" }, { productId: "dress", size: "L", qty: 1 }, "c4"),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(products.get("dress")?.stock.L).toBe(0);
  });

  test("rolls back stock on failed updateItem and restores stock on removeItem", async () => {
    const order = await gateway.addItem(session.id, buyer, { ...dress, qty: 2 }, "c1");
    await expect(gateway.updateItem(order.id, dress, { size: "L" }, "c2")).rejects.toThrow();
    expect(products.get("dress")?.stock).toEqual({ M: 1, L: 1 });

    const swapped = await gateway.updateItem(order.id, dress, { productId: bag.productId, size: null, qty: 1 }, "c3");
    expect(swapped.total).toBe(120_000);
    expect(products.get("dress")?.stock.M).toBe(3);
    expect(products.get("bag")?.stock[""]).toBe(1);

    const cancelled = await gateway.removeItem(order.id, null, "c4");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.items).toHaveLength(1);
    expect(products.get("bag")?.stock[""]).toBe(2);
    expect(await gateway.getOpenOrders(session.id, [buyer.externalId])).toEqual(new Map());

    const next = await gateway.addItem(session.id, buyer, { ...bag, qty: 1 }, "c5");
    const emptied = await gateway.removeItem(next.id, bag, "c6");
    expect(emptied).toMatchObject({ code: "A2", status: "cancelled", items: [], total: 0 });
    expect(products.get("bag")?.stock[""]).toBe(2);
  });
});
