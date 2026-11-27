import type { Order, OrderItem, RiskAlert } from "@livemate/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskEngine } from "./engine.ts";
import { InMemoryBuyerHistoryStore } from "./history.ts";

const start = Date.parse("2026-11-27T02:00:00.000Z");
const buyerExternalId = "buyer-1";
const sessionId = "session-1";

function orderWithQuantities(quantities: number[], id = "order-1"): Order {
  const items = quantities.map((qty, index): OrderItem => ({
    productId: `product-${index + 1}`,
    productCode: `V0${index + 1}`,
    productName: `Món ${index + 1}`,
    size: "L",
    qty,
    unitPrice: 100_000,
  }));

  return {
    id,
    code: "A12",
    sessionId,
    buyer: { id: "buyer-internal-1", source: "room", externalId: buyerExternalId, displayName: "An" },
    items,
    total: items.reduce((total, item) => total + item.qty * item.unitPrice, 0),
    status: "pending_payment",
    publicToken: `token-${id}`,
    sourceCommentIds: ["comment-1"],
    sellerEdited: false,
    createdAt: new Date(start).toISOString(),
    updatedAt: new Date(start).toISOString(),
  };
}

describe("InMemoryBuyerHistoryStore", () => {
  it("initializes seeded counts and records outcomes for each buyer independently", async () => {
    const history = new InMemoryBuyerHistoryStore({ [buyerExternalId]: { boomed: 2, completed: 3 } });

    await expect(history.getStats(buyerExternalId)).resolves.toEqual({ boomed: 2, completed: 3 });
    await expect(history.getStats("buyer-2")).resolves.toEqual({ boomed: 0, completed: 0 });
    await Promise.all([
      history.recordOutcome(buyerExternalId, "boomed"),
      history.recordOutcome(buyerExternalId, "completed"),
      history.recordOutcome("buyer-2", "completed"),
    ]);

    await expect(history.getStats(buyerExternalId)).resolves.toEqual({ boomed: 3, completed: 4 });
    await expect(history.getStats("buyer-2")).resolves.toEqual({ boomed: 0, completed: 1 });
  });
});

describe("RiskEngine", () => {
  const engines: RiskEngine[] = [];

  function setup(options: Partial<ConstructorParameters<typeof RiskEngine>[0]> = {}) {
    const alerts: RiskAlert[] = [];
    const history = new InMemoryBuyerHistoryStore();
    const engine = new RiskEngine({ history, emit: (alert) => alerts.push(alert), ...options });
    engines.push(engine);
    return { engine, alerts, history };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    for (const engine of engines.splice(0)) engine.dispose();
    vi.useRealTimers();
  });

  it("uses closed orders to warn after one boom and escalate after two", async () => {
    const { engine, alerts, history } = setup();

    await engine.onOrderClosed(orderWithQuantities([1], "completed"), "completed");
    await engine.onOrderCreated(orderWithQuantities([1], "first-boom"));
    expect(alerts).toEqual([]);

    await engine.onOrderClosed(orderWithQuantities([1], "first-boom"), "boomed");
    await engine.onOrderCreated(orderWithQuantities([1], "second-boom"));
    await engine.onOrderClosed(orderWithQuantities([1], "second-boom"), "boomed");
    await engine.onOrderCreated(orderWithQuantities([1]));

    expect(alerts).toEqual([
      {
        id: expect.stringMatching(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i),
        sessionId,
        orderId: "second-boom",
        buyerExternalId,
        kind: "buyer_history_boom",
        severity: "warning",
        message: "Khách từng không nhận 1 đơn — nên thu tiền trước",
        createdAt: "2026-11-27T02:00:00.000Z",
      },
      expect.objectContaining({
        orderId: "order-1",
        kind: "buyer_history_boom",
        severity: "danger",
        message: "Khách từng không nhận 2 đơn — nên thu tiền trước",
      }),
    ]);
    expect(alerts[0]?.id).not.toBe(alerts[1]?.id);
    await expect(history.getStats(buyerExternalId)).resolves.toEqual({ boomed: 2, completed: 1 });
  });

  it("warns at exactly five on one line or ten items across several lines", () => {
    const { engine, alerts } = setup();

    engine.onOrderChanged(orderWithQuantities([4, 4, 1]));
    expect(alerts).toEqual([]);

    engine.onOrderChanged(orderWithQuantities([5, 1]));
    engine.onOrderChanged(orderWithQuantities([4, 4, 2], "order-2"));
    expect(alerts).toEqual([
      expect.objectContaining({
        orderId: "order-1",
        kind: "unusual_quantity",
        severity: "warning",
        message: "Chốt 6 món — cần xác nhận lại",
      }),
      expect.objectContaining({
        orderId: "order-2",
        kind: "unusual_quantity",
        severity: "warning",
        message: "Chốt 10 món — cần xác nhận lại",
      }),
    ]);
  });

  it("deduplicates quantity alerts until the order falls below both configured thresholds", () => {
    const { engine, alerts } = setup({ bigQty: 3 });

    engine.onOrderChanged(orderWithQuantities([2, 2, 1]));
    engine.onOrderChanged(orderWithQuantities([3, 3]));
    engine.onOrderChanged(orderWithQuantities([2, 2, 2]));
    engine.onOrderChanged(orderWithQuantities([3]));
    expect(alerts.map(({ message }) => message)).toEqual(["Chốt 6 món — cần xác nhận lại"]);

    engine.onOrderChanged(orderWithQuantities([2, 2]));
    engine.onOrderChanged(orderWithQuantities([3]));
    expect(alerts.map(({ message }) => message)).toEqual([
      "Chốt 6 món — cần xác nhận lại",
      "Chốt 3 món — cần xác nhận lại",
    ]);
  });

  it("warns on the third action within a minute and limits alerts to one per buyer per window", () => {
    const { engine, alerts } = setup();

    engine.onBuyerAction(sessionId, buyerExternalId, "order-1");
    vi.advanceTimersByTime(30_000);
    engine.onBuyerAction(sessionId, buyerExternalId, "order-1");
    engine.onBuyerAction(sessionId, "buyer-2", "order-2");
    expect(alerts).toEqual([]);

    vi.advanceTimersByTime(29_999);
    engine.onBuyerAction(sessionId, buyerExternalId, null);
    engine.onBuyerAction("session-2", buyerExternalId, "order-3");
    expect(alerts).toEqual([
      expect.objectContaining({
        sessionId,
        orderId: null,
        buyerExternalId,
        kind: "unusual_quantity",
        severity: "warning",
        message: "Khách thao tác 3 lần trong 1 phút — cần xác nhận lại",
      }),
    ]);

    vi.advanceTimersByTime(59_999);
    engine.onBuyerAction("session-2", buyerExternalId, "order-4");
    expect(alerts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    engine.onBuyerAction("session-2", buyerExternalId, "order-4");
    expect(alerts).toHaveLength(1);
    engine.onBuyerAction("session-2", buyerExternalId, "order-4");
    expect(alerts[1]).toMatchObject({ sessionId: "session-2", orderId: "order-4" });

    engine.onBuyerAction(sessionId, "buyer-2", "order-2");
    engine.onBuyerAction(sessionId, "buyer-2", "order-2");
    expect(alerts).toHaveLength(2);
    engine.onBuyerAction(sessionId, "buyer-2", "order-2");
    expect(alerts[2]).toMatchObject({ buyerExternalId: "buyer-2" });
  });

  it("expires old buyer actions using the configured window and count", () => {
    let now = start;
    const { engine, alerts } = setup({ now: () => now, burstWindowMs: 10_000, burstCount: 2 });

    engine.onBuyerAction(sessionId, buyerExternalId, "order-1");
    now += 10_000;
    engine.onBuyerAction(sessionId, buyerExternalId, "order-1");
    expect(alerts).toEqual([]);

    now += 9_999;
    engine.onBuyerAction(sessionId, buyerExternalId, "order-1");
    expect(alerts).toEqual([
      expect.objectContaining({
        message: "Khách thao tác 2 lần trong 1 phút — cần xác nhận lại",
        createdAt: new Date(now).toISOString(),
      }),
    ]);
  });

  it("emits a danger alert when the default payment grace period expires", () => {
    const { engine, alerts } = setup();

    engine.onPaymentReported(orderWithQuantities([1]));
    vi.advanceTimersByTime(299_999);
    expect(alerts).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(alerts).toEqual([
      expect.objectContaining({
        sessionId,
        orderId: "order-1",
        buyerExternalId,
        kind: "payment_not_found",
        severity: "danger",
        message: "Khách báo đã chuyển cho đơn #A12 nhưng chưa thấy giao dịch khớp",
        createdAt: "2026-11-27T02:05:00.000Z",
      }),
    ]);
  });

  it("cancels only the timer for the confirmed order", () => {
    const { engine, alerts } = setup({ paymentGraceMs: 1_000 });

    engine.onPaymentReported(orderWithQuantities([1]));
    engine.onPaymentReported(orderWithQuantities([1], "order-2"));
    vi.advanceTimersByTime(999);
    engine.onPaymentConfirmed("order-1");
    engine.onPaymentConfirmed("order-1");
    vi.advanceTimersByTime(1);

    expect(alerts.map(({ orderId }) => orderId)).toEqual(["order-2"]);
  });

  it("restarts the grace period on a second report and emits only once", () => {
    const { engine, alerts } = setup({ paymentGraceMs: 1_000 });
    const order = orderWithQuantities([1]);

    engine.onPaymentReported(order);
    vi.advanceTimersByTime(600);
    engine.onPaymentReported(order);
    vi.advanceTimersByTime(999);
    expect(alerts).toEqual([]);

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1_000);
    expect(alerts).toEqual([
      expect.objectContaining({ kind: "payment_not_found", createdAt: "2026-11-27T02:00:01.600Z" }),
    ]);
  });

  it("clears all pending payment timers on disposal using the injected timer functions", () => {
    const setTimer = vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
    const clearTimer = vi.fn((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
    const { engine, alerts } = setup({ paymentGraceMs: 1_000, setTimer, clearTimer });

    engine.onPaymentReported(orderWithQuantities([1]));
    engine.onPaymentReported(orderWithQuantities([1], "order-2"));
    engine.dispose();
    vi.advanceTimersByTime(1_000);

    expect(setTimer).toHaveBeenCalledTimes(2);
    expect(clearTimer.mock.calls).toEqual(setTimer.mock.results.map(({ value }) => [value]));
    expect(alerts).toEqual([]);
  });

  it("emits informational stock alerts with the size when one was requested", () => {
    const { engine, alerts } = setup();

    engine.onOutOfStock(sessionId, buyerExternalId, "V05", "L");
    engine.onOutOfStock(sessionId, buyerExternalId, "V06", null);

    expect(alerts).toEqual([
      expect.objectContaining({
        sessionId,
        orderId: null,
        buyerExternalId,
        kind: "out_of_stock",
        severity: "info",
        message: "Khách chốt V05 size L đã hết hàng — đã tự trả lời khách",
      }),
      expect.objectContaining({
        kind: "out_of_stock",
        severity: "info",
        message: "Khách chốt V06 đã hết hàng — đã tự trả lời khách",
      }),
    ]);
  });
});
