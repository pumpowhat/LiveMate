import type { LiveSession, Product } from "@livemate/shared";
import { beforeEach, expect, test } from "vitest";
import type { BuyerRef } from "./gateway.ts";
import { InMemoryOrderGateway } from "./memory-gateway.ts";

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
let catalog: Product[];
let gateway: InMemoryOrderGateway;

beforeEach(() => {
  catalog = [
    { id: "dress", code: "V03", name: "Dress", price: 250_000, sizes: ["M", "L"], stock: { M: 3, L: 1 } },
    { id: "bag", code: "T01", name: "Bag", price: 120_000, sizes: [], stock: { "": 2 } },
  ];
  gateway = new InMemoryOrderGateway({ session, catalog, previouslyFeatured: ["A01"] });
});

test("tracks featured history and returns isolated session and product snapshots", async () => {
  gateway.setFeatured("T01");
  const context = await gateway.getSessionContext(session.id);
  expect(context.session.featuredProductId).toBe("bag");
  expect(context.previouslyFeatured).toEqual(["V03", "A01"]);
  expect(session.featuredProductId).toBe("dress");

  context.session.featuredProductId = null;
  context.previouslyFeatured.pop();
  context.catalog[0]!.stock.M = 0;
  gateway.getProduct("V03")!.stock.M = 0;
  expect(await gateway.getSessionContext(session.id)).toMatchObject({
    session: { featuredProductId: "bag" },
    previouslyFeatured: ["V03", "A01"],
    catalog,
  });
  await expect(gateway.getSessionContext("unknown")).rejects.toThrow();
  await expect(gateway.getOpenOrders("unknown", [])).rejects.toThrow();
  await expect(gateway.addItem("unknown", buyer, { ...dress, qty: 1 }, "c1")).rejects.toThrow();
});

test("merges a seeded line into one open order and isolates order snapshots", async () => {
  const seeded = gateway.seedOrder(buyer, [{ item: "V03", size: "M", qty: 1 }]);
  seeded.items[0]!.qty = 50;
  const order = await gateway.addItem(session.id, buyer, { ...dress, qty: 2 }, "c1");
  expect(order).toMatchObject({
    id: seeded.id,
    code: "A1",
    status: "pending_payment",
    items: [{ productCode: "V03", size: "M", qty: 3 }],
    total: 750_000,
    sourceCommentIds: ["c1"],
    sellerEdited: false,
  });
  expect(order.updatedAt).not.toBe(seeded.updatedAt);
  expect(order.publicToken).toMatch(/^[0-9a-f-]{36}$/);
  expect(gateway.getProduct("V03")?.stock.M).toBe(0);
  expect(catalog[0]!.stock.M).toBe(3);

  const openOrders = await gateway.getOpenOrders(session.id, [buyer.externalId, "missing"]);
  expect(openOrders).toEqual(new Map([[buyer.externalId, order]]));
  openOrders.get(buyer.externalId)!.sourceCommentIds.pop();
  gateway.listOrders()[0]!.items.pop();
  expect(gateway.listOrders()).toEqual([order]);
});

test("rejects insufficient stock without changing the order or its reservations", async () => {
  const seeded = gateway.seedOrder(buyer, [{ item: "V03", size: "M", qty: 2 }]);
  await expect(gateway.updateItem(seeded.id, dress, { size: "L" }, "c1")).rejects.toThrow();
  expect(gateway.listOrders()).toEqual([seeded]);
  expect(gateway.getProduct("V03")?.stock).toEqual({ M: 1, L: 1 });

  const updated = await gateway.updateItem(seeded.id, dress, { productId: bag.productId, size: null, qty: 1 }, "c2");
  expect(updated.items).toMatchObject([{ ...bag, productCode: "T01", productName: "Bag", qty: 1, unitPrice: 120_000 }]);
  expect(updated.total).toBe(120_000);
  expect(updated.sourceCommentIds).toEqual(["c2"]);
  expect(gateway.getProduct("V03")?.stock.M).toBe(3);
  expect(gateway.getProduct("T01")?.stock[""]).toBe(1);
});

test("validates combined seed quantities before reserving any stock", () => {
  expect(() => gateway.seedOrder(buyer, [
    { item: "T01", size: null, qty: 1 },
    { item: "V03", size: "L", qty: 1 },
    { item: "V03", size: "L", qty: 1 },
  ])).toThrow();
  expect(gateway.listOrders()).toEqual([]);
  expect(gateway.getProduct("T01")?.stock[""]).toBe(2);
  expect(gateway.getProduct("V03")?.stock.L).toBe(1);
});

test("restores stock on cancellation and lets the buyer open a new order", async () => {
  const seeded = gateway.seedOrder(buyer, [
    { item: "V03", size: "M", qty: 1 },
    { item: "T01", size: null, qty: 1 },
  ]);
  const cancelled = await gateway.removeItem(seeded.id, null, "c1");
  expect(cancelled).toMatchObject({ status: "cancelled", items: seeded.items, sourceCommentIds: ["c1"] });
  expect(gateway.getProduct("V03")?.stock.M).toBe(3);
  expect(gateway.getProduct("T01")?.stock[""]).toBe(2);
  expect(await gateway.getOpenOrders(session.id, [buyer.externalId])).toEqual(new Map());

  const next = await gateway.addItem(session.id, buyer, { ...bag, qty: 1 }, "c2");
  const emptied = await gateway.removeItem(next.id, bag, "c3");
  expect(emptied).toMatchObject({ code: "A2", status: "cancelled", items: [], total: 0, sourceCommentIds: ["c2", "c3"] });
  expect(gateway.getProduct("T01")?.stock[""]).toBe(2);
});
