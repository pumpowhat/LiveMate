import { randomUUID } from "node:crypto";
import type { Order, RiskAlert } from "@livemate/shared";
import type { BuyerHistoryStore } from "./history.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

interface RiskEngineOptions {
  history: BuyerHistoryStore;
  emit: (alert: RiskAlert) => void;
  now?: () => number;
  paymentGraceMs?: number;
  burstWindowMs?: number;
  burstCount?: number;
  bigQty?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

interface BuyerActivity {
  timestamps: number[];
  lastAlertAt?: number;
}

export class RiskEngine {
  private readonly history: BuyerHistoryStore;
  private readonly emit: (alert: RiskAlert) => void;
  private readonly now: () => number;
  private readonly paymentGraceMs: number;
  private readonly burstWindowMs: number;
  private readonly burstCount: number;
  private readonly bigQty: number;
  private readonly setTimer: NonNullable<RiskEngineOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<RiskEngineOptions["clearTimer"]>;
  private readonly largeOrders = new Set<string>();
  private readonly buyerActivity = new Map<string, BuyerActivity>();
  private readonly paymentTimers = new Map<string, TimerHandle>();

  constructor({
    history,
    emit,
    now = Date.now,
    paymentGraceMs = 5 * 60_000,
    burstWindowMs = 60_000,
    burstCount = 3,
    bigQty = 5,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }: RiskEngineOptions) {
    this.history = history;
    this.emit = emit;
    this.now = now;
    this.paymentGraceMs = paymentGraceMs;
    this.burstWindowMs = burstWindowMs;
    this.burstCount = burstCount;
    this.bigQty = bigQty;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async onOrderCreated(order: Order): Promise<void> {
    const { id: orderId, sessionId, buyer: { externalId: buyerExternalId } } = order;
    const { boomed } = await this.history.getStats(buyerExternalId);
    if (boomed < 1) return;

    this.emitAlert({
      sessionId,
      orderId,
      buyerExternalId,
      kind: "buyer_history_boom",
      severity: boomed >= 2 ? "danger" : "warning",
      message: `Khách từng không nhận ${boomed} đơn — nên thu tiền trước`,
    });
  }

  onOrderChanged(order: Order): void {
    const quantity = order.items.reduce((total, item) => total + item.qty, 0);
    const isLarge = quantity >= this.bigQty * 2 || order.items.some((item) => item.qty >= this.bigQty);
    if (!isLarge) {
      this.largeOrders.delete(order.id);
      return;
    }
    if (this.largeOrders.has(order.id)) return;

    this.largeOrders.add(order.id);
    this.emitAlert({
      sessionId: order.sessionId,
      orderId: order.id,
      buyerExternalId: order.buyer.externalId,
      kind: "unusual_quantity",
      severity: "warning",
      message: `Chốt ${quantity} món — cần xác nhận lại`,
    });
  }

  onBuyerAction(sessionId: string, buyerExternalId: string, orderId: string | null): void {
    const now = this.now();
    const cutoff = now - this.burstWindowMs;
    const activity = this.buyerActivity.get(buyerExternalId) ?? { timestamps: [] };
    activity.timestamps = activity.timestamps.filter((timestamp) => timestamp > cutoff);
    activity.timestamps.push(now);
    this.buyerActivity.set(buyerExternalId, activity);

    const count = activity.timestamps.length;
    if (count < this.burstCount || (activity.lastAlertAt !== undefined && activity.lastAlertAt > cutoff)) return;

    activity.lastAlertAt = now;
    this.emitAlert({
      sessionId,
      orderId,
      buyerExternalId,
      kind: "unusual_quantity",
      severity: "warning",
      message: `Khách thao tác ${count} lần trong 1 phút — cần xác nhận lại`,
    }, now);
  }

  onPaymentReported(order: Order): void {
    const { id: orderId, code, sessionId, buyer: { externalId: buyerExternalId } } = order;
    this.onPaymentConfirmed(orderId);

    const timer: TimerHandle = this.setTimer(() => {
      if (this.paymentTimers.get(orderId) !== timer) return;
      this.paymentTimers.delete(orderId);
      this.emitAlert({
        sessionId,
        orderId,
        buyerExternalId,
        kind: "payment_not_found",
        severity: "danger",
        message: `Khách báo đã chuyển cho đơn #${code} nhưng chưa thấy giao dịch khớp`,
      });
    }, this.paymentGraceMs);
    this.paymentTimers.set(orderId, timer);
  }

  onPaymentConfirmed(orderId: string): void {
    this.clearPaymentTimer(orderId);
  }

  clearPaymentTimer(orderId: string): void {
    const timer = this.paymentTimers.get(orderId);
    if (timer === undefined) return;

    this.paymentTimers.delete(orderId);
    this.clearTimer(timer);
  }

  onOutOfStock(sessionId: string, buyerExternalId: string, productCode: string, size: string | null): void {
    const product = size === null ? productCode : `${productCode} size ${size}`;
    this.emitAlert({
      sessionId,
      orderId: null,
      buyerExternalId,
      kind: "out_of_stock",
      severity: "info",
      message: `Khách chốt ${product} đã hết hàng — đã tự trả lời khách`,
    });
  }

  onOrderClosed(order: Order, outcome: "boomed" | "completed"): Promise<void> {
    return this.history.recordOutcome(order.buyer.externalId, outcome);
  }

  dispose(): void {
    for (const orderId of this.paymentTimers.keys()) this.onPaymentConfirmed(orderId);
    this.largeOrders.clear();
    this.buyerActivity.clear();
  }

  private emitAlert(alert: Omit<RiskAlert, "id" | "createdAt">, now = this.now()): void {
    this.emit({ ...alert, id: randomUUID(), createdAt: new Date(now).toISOString() });
  }
}
