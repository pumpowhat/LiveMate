import { Product, type AiAction, type LiveSession, type Order } from "@livemate/shared";
import { expect, test } from "vitest";
import catalogFixture from "../../fixtures/catalog.json" with { type: "json" };
import type { BuyerRef } from "./gateway.ts";
import { InMemoryOrderGateway } from "./memory-gateway.ts";
import { createResolver, resolveActions } from "./rules.ts";

const catalog = Product.array().parse(catalogFixture);
const buyer: BuyerRef = { externalId: "buyer", name: "Lan", source: "room" };
const session: LiveSession = {
  id: "live",
  roomCode: "room",
  status: "live",
  featuredProductId: "p_v03",
  facebookObjectId: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
};

type Create = Extract<AiAction, { action: "create" }>;
type Update = Extract<AiAction, { action: "update" }>;
const create = (overrides: Partial<Create> = {}): Create => ({
  action: "create", commentId: "c1", buyer: buyer.externalId, item: "V03", size: "M", qty: 1, ...overrides,
});
const update = (overrides: Partial<Update> = {}): Update => ({
  action: "update", commentId: "c2", buyer: buyer.externalId, item: "V03", size: null, qty: null, newItem: null, ...overrides,
});

function resolve(action: AiAction) {
  return resolveActions([action], catalog, new Map());
}

async function existingOrder() {
  const gateway = new InMemoryOrderGateway({ session, catalog });
  const order = gateway.seedOrder(buyer, [{ item: "V03", size: "M", qty: 1 }]);
  const context = await gateway.getSessionContext(session.id);
  return {
    order,
    resolve(action: AiAction, currentOrder: Order = order) {
      return resolveActions([action], context.catalog, new Map([[buyer.externalId, currentOrder]]));
    },
  };
}

test("creates a line for a valid item and size", () => {
  expect(resolve(create({ qty: 2 }))).toEqual([
    { kind: "add", commentId: "c1", buyer: buyer.externalId, line: { productId: "p_v03", size: "M", qty: 2 } },
  ]);
});

test("normalizes lowercase sizes to the catalog size", () => {
  expect(resolve(create({ size: "m" }))).toMatchObject([{ kind: "add", line: { size: "M" } }]);
});

test.each([
  [{ size: null }, "missing_size"],
  [{ size: "XXL" }, "invalid_size"],
  [{ item: "Z99" }, "unknown_item"],
  [{ item: "V05", size: "L" }, "out_of_stock"],
] as const)("replies to an invalid create %j with %s", (overrides, reason) => {
  expect(resolve(create(overrides))).toMatchObject([{ kind: "reply", reason }]);
});

test("rejects a second create after the only Q01 size 30 is reserved in the batch", () => {
  const actions = [
    create({ item: "Q01", size: "30" }),
    create({ item: "Q01", size: "30", commentId: "c2", buyer: "other-buyer" }),
  ];
  expect(resolveActions(actions, catalog, new Map())).toMatchObject([
    { kind: "add", commentId: "c1", line: { productId: "p_q01", size: "30", qty: 1 } },
    { kind: "reply", commentId: "c2", reason: "out_of_stock" },
  ]);
});

test("forces size to null for a product without sizes", () => {
  expect(resolve(create({ item: "T01", size: "M" }))).toMatchObject([
    { kind: "add", line: { productId: "p_t01", size: null, qty: 1 } },
  ]);
});

test.each([
  ["changes the size", { size: "L" }, { size: "L" }],
  ["changes the quantity", { qty: 3 }, { qty: 3 }],
  ["keeps the old size when swapping to a product that offers it", { newItem: "V05" }, { productId: "p_v05" }],
] as const)("%s on an existing order", async (_name, overrides, patch) => {
  const existing = await existingOrder();
  expect(existing.resolve(update(overrides))).toEqual([
    { kind: "update", commentId: "c2", buyer: buyer.externalId, orderId: existing.order.id, line: { productId: "p_v03", size: "M" }, patch },
  ]);
});

test("treats an update without an order as an add", () => {
  expect(resolve(update({ size: "M" }))).toMatchObject([
    { kind: "add", line: { productId: "p_v03", size: "M", qty: 1 } },
  ]);
});

test("cancels the whole order when no item is specified", async () => {
  const existing = await existingOrder();
  expect(existing.resolve({ action: "cancel", commentId: "c2", buyer: buyer.externalId, item: null })).toEqual([
    { kind: "remove", commentId: "c2", buyer: buyer.externalId, orderId: existing.order.id, line: null },
  ]);
});

test("replies when asked to cancel an item outside the order", async () => {
  const existing = await existingOrder();
  expect(existing.resolve({ action: "cancel", commentId: "c2", buyer: buyer.externalId, item: "V05" })).toMatchObject([
    { kind: "reply", reason: "not_in_order" },
  ]);
});

test("sends updates to a seller-edited order for review", async () => {
  const existing = await existingOrder();
  const action = update({ size: "L" });
  expect(existing.resolve(action, { ...existing.order, sellerEdited: true })).toEqual([
    { kind: "needs_review", commentId: "c2", buyer: buyer.externalId, orderId: existing.order.id, action },
  ]);
});

test("updates the line just created earlier in the same batch after setOrder", async () => {
  const gateway = new InMemoryOrderGateway({ session, catalog });
  const resolver = createResolver(catalog, new Map());
  const adds = resolver.resolve(create());
  expect(adds).toMatchObject([{ kind: "add", line: { productId: "p_v03", size: "M", qty: 1 } }]);
  const [add] = adds;
  if (add?.kind !== "add") throw new Error("Expected an add operation");
  const order = await gateway.addItem(session.id, buyer, add.line, add.commentId);
  resolver.setOrder(buyer.externalId, order);

  expect(resolver.resolve(update({ size: "L" }))).toEqual([
    { kind: "update", commentId: "c2", buyer: buyer.externalId, orderId: order.id, line: { productId: "p_v03", size: "M" }, patch: { size: "L" } },
  ]);
});
