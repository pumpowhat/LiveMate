import type { Order, Product } from "@livemate/shared";
import { describe, expect, it } from "vitest";
import { ConflictError } from "./errors.ts";
import { MemoryBackendStore } from "./memory-store.ts";
import { computeSessionSummary, evaluateOrderTransition, normalizeProductData } from "./transitions.ts";

const catalog: Product[] = [
  { id: "p_v03", code: "V03", name: "Váy hoa nhí", sizes: ["S", "M", "L"], price: 250_000, stock: { S: 2, M: 5, L: 3 } },
  { id: "p_t01", code: "T01", name: "Túi tote", sizes: [], price: 120_000, stock: { "": 4 } },
];

describe("evaluateOrderTransition", () => {
  it("enforces explicit legal state transitions", () => {
    expect(evaluateOrderTransition("pending_payment", "approve")).toEqual({
      nextStatus: "pending_payment",
      sellerEdited: true,
      restoreStock: false,
      changed: true,
    });
    expect(evaluateOrderTransition("pending_payment", "report_payment")).toEqual({
      nextStatus: "awaiting_confirmation",
      restoreStock: false,
      changed: true,
    });
    expect(evaluateOrderTransition("awaiting_confirmation", "report_payment")).toEqual({
      nextStatus: "awaiting_confirmation",
      restoreStock: false,
      changed: false,
    });
    expect(evaluateOrderTransition("awaiting_confirmation", "confirm")).toEqual({
      nextStatus: "paid",
      restoreStock: false,
      changed: true,
    });
    expect(evaluateOrderTransition("pending_payment", "confirm")).toEqual({
      nextStatus: "paid",
      restoreStock: false,
      changed: true,
    });
    expect(evaluateOrderTransition("paid", "deliver")).toEqual({
      nextStatus: "delivered",
      restoreStock: false,
      changed: true,
    });
    expect(evaluateOrderTransition("awaiting_confirmation", "cancel")).toEqual({
      nextStatus: "cancelled",
      restoreStock: true,
      changed: true,
    });
  });

  it.each([
    ["paid", "report_payment"],
    ["delivered", "report_payment"],
    ["cancelled", "report_payment"],
    ["paid", "confirm"],
    ["delivered", "confirm"],
    ["cancelled", "confirm"],
    ["pending_payment", "deliver"],
    ["awaiting_confirmation", "deliver"],
    ["delivered", "deliver"],
    ["cancelled", "deliver"],
    ["paid", "cancel"],
    ["delivered", "cancel"],
    ["cancelled", "cancel"],
    ["paid", "approve"],
    ["delivered", "approve"],
    ["cancelled", "approve"],
    ["paid", "remind"],
    ["cancelled", "remind"],
  ] as const)("rejects illegal transition from %s via %s with ConflictError", (status, action) => {
    expect(() => evaluateOrderTransition(status, action)).toThrow(ConflictError);
  });
});

describe("MemoryBackendStore order lifecycle & stock restoration", () => {
  it("restores stock on cancel, sets sellerEdited on patch/approve, and computes summary", async () => {
    const store = new MemoryBackendStore();
    const { session } = await store.ensureDemoSeed(catalog);
    const products = await store.listProducts(session.id);
    const v03 = products.find((p) => p.code === "V03")!;
    const t01 = products.find((p) => p.code === "T01")!;

    const order1 = await store.gateway.addItem(
      session.id,
      { externalId: "b1", name: "Lan", source: "room" },
      { productId: v03.id, size: "M", qty: 2 },
      "c1",
    );
    expect((await store.getProductById(session.id, v03.id))?.stock.M).toBe(3);

    const patched = await store.sellerPatchOrderItem(
      session.id,
      order1.id,
      { productId: v03.id, size: "M" },
      { qty: 3 },
    );
    expect(patched.sellerEdited).toBe(true);
    expect(patched.total).toBe(750_000);
    expect((await store.getProductById(session.id, v03.id))?.stock.M).toBe(2);

    const reported = await store.transitionOrderByPublicToken(order1.publicToken, "report_payment");
    expect(reported.order.status).toBe("awaiting_confirmation");
    expect(reported.changed).toBe(true);

    const confirmed = await store.transitionOrderById(order1.id, "confirm");
    expect(confirmed.order.status).toBe("paid");

    const delivered = await store.transitionOrderById(order1.id, "deliver");
    expect(delivered.order.status).toBe("delivered");

    const order2 = await store.gateway.addItem(
      session.id,
      { externalId: "b2", name: "Minh", source: "room" },
      { productId: t01.id, size: null, qty: 2 },
      "c2",
    );
    expect((await store.getProductById(session.id, t01.id))?.stock[""]).toBe(2);

    const approved = await store.transitionOrderById(order2.id, "approve");
    expect(approved.order.sellerEdited).toBe(true);

    const cancelled = await store.transitionOrderById(order2.id, "cancel");
    expect(cancelled.order.status).toBe("cancelled");
    expect((await store.getProductById(session.id, t01.id))?.stock[""]).toBe(4);

    const order3 = await store.gateway.addItem(
      session.id,
      { externalId: "b3", name: "Hoa", source: "room" },
      { productId: v03.id, size: "S", qty: 1 },
      "c3",
    );

    const summary = await store.getSessionSummary(session.id);
    expect(summary.revenue).toBe(750_000);
    expect(summary.counts).toEqual({
      total: 3,
      pending_payment: 1,
      awaiting_confirmation: 0,
      paid: 0,
      delivered: 1,
      cancelled: 1,
    });
    expect(summary.pendingOrders.map((o) => o.id)).toEqual([order3.id]);
    expect(summary.topProducts).toEqual([
      { productCode: "V03", productName: "Váy hoa nhí", qty: 3, revenue: 750_000 },
    ]);
  });

  it("normalizes product codes, sizes, and stock keys", () => {
    expect(
      normalizeProductData({
        code: " v09 ",
        name: " Áo len ",
        sizes: [" s ", "M", "s"],
        price: 199000,
        stock: { s: 4, extra: 9 },
      }),
    ).toEqual({
      code: "V09",
      name: "Áo len",
      sizes: ["S", "M"],
      price: 199000,
      stock: { S: 4, M: 0 },
    });
  });

  it("computes empty summary safely", () => {
    const summary = computeSessionSummary(
      {
        id: "s1",
        roomCode: "R1",
        status: "live",
        featuredProductId: null,
        facebookObjectId: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      },
      [] as Order[],
    );
    expect(summary.revenue).toBe(0);
    expect(summary.topProducts).toEqual([]);
    expect(summary.pendingOrders).toEqual([]);
  });
});
