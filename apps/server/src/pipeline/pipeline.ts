import type { Comment, CommentVerdict, Order } from "@livemate/shared";
import { extractActions } from "./extract.ts";
import { prefilter } from "./filter.ts";
import type { BuyerRef, OrderGateway } from "./gateway.ts";
import type { LlmClient } from "./llm.ts";
import type { PromptOrderLine } from "./prompt.ts";
import { createResolver, type Operation, type ReplyMeta, type ReplyReason } from "./rules.ts";

export interface BatchMetrics {
  size: number;
  /** Thời gian gọi LLM (gồm chờ quota / chuyển model). */
  llmMs: number;
  /** Từ lúc bình luận cũ nhất trong lô được nhận tới khi xử lý xong. */
  oldestWaitMs: number;
  actions: number;
  ok: boolean;
}

/** Đầu ra của pipeline — lớp tích hợp (Socket.IO, Facebook) lắng nghe các callback này. */
export interface PipelineSink {
  onVerdict(sessionId: string, commentId: string, verdict: CommentVerdict, orderId?: string): void;
  onOrder(sessionId: string, order: Order, created: boolean, comment: Comment): void;
  /** Trả lời người mua: Facebook -> reply bình luận; phòng live -> reply:new. */
  onReply(sessionId: string, comment: Comment, text: string, reason?: ReplyReason, meta?: ReplyMeta): void;
  /** Đơn bị người bán sửa tay — AI không tự đổi. */
  onNeedsReview(sessionId: string, comment: Comment, op: Extract<Operation, { kind: "needs_review" }>): void;
  onError(sessionId: string, err: unknown, comments: Comment[]): void;
  /** Số liệu mỗi lô (tùy chọn) — cho /api/dev/metrics và load test. */
  onBatch?(sessionId: string, m: BatchMetrics): void;
}

export interface PipelineOptions {
  /** Cửa sổ gom lô tính từ bình luận đầu tiên (ms). */
  batchWindowMs?: number;
  /** Lô đầy thì gửi ngay. */
  maxBatchSize?: number;
}

/**
 * Bình luận -> [1] lọc nhanh -> [2] gom lô -> [3] LLM -> [4] hành động -> [5] quy tắc -> đơn.
 * Mỗi phiên xử lý TUẦN TỰ từng lô (một lần gọi LLM tại một thời điểm) để "chốt" luôn
 * được ghi trước "đổi size" của cùng người.
 */
export class CommentPipeline {
  private readonly windowMs: number;
  private readonly maxBatch: number;
  private readonly pending = new Map<string, { comments: Comment[]; timer: NodeJS.Timeout | null }>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Thời điểm nhận từng bình luận đang chờ (để đo thời gian chờ trong lô). */
  private readonly receivedAt = new Map<string, number>();

  constructor(
    private readonly llm: LlmClient,
    private readonly gateway: OrderGateway,
    private readonly sink: PipelineSink,
    opts: PipelineOptions = {},
  ) {
    this.windowMs = opts.batchWindowMs ?? 1500;
    this.maxBatch = opts.maxBatchSize ?? 20;
  }

  /** Nhận bình luận mới. Trả về ngay; kết quả đến qua sink. */
  async push(comment: Comment): Promise<void> {
    const ctx = await this.gateway.getSessionContext(comment.sessionId);
    const orders = await this.gateway.getOpenOrders(comment.sessionId, [comment.buyerExternalId]);
    const f = prefilter(comment.text, {
      productCodes: ctx.catalog.map((p) => p.code),
      buyerHasOrder: orders.has(comment.buyerExternalId),
    });
    if (!f.pass) {
      this.sink.onVerdict(comment.sessionId, comment.id, "ignored");
      return;
    }
    this.sink.onVerdict(comment.sessionId, comment.id, "queued");
    this.receivedAt.set(comment.id, Date.now());

    let slot = this.pending.get(comment.sessionId);
    if (!slot) {
      slot = { comments: [], timer: null };
      this.pending.set(comment.sessionId, slot);
    }
    slot.comments.push(comment);
    if (slot.comments.length >= this.maxBatch) this.flush(comment.sessionId);
    else slot.timer ??= setTimeout(() => this.flush(comment.sessionId), this.windowMs);
  }

  /**
   * Xếp một lượt xử lý vào hàng đợi của phiên. Lô được lấy ra lúc lượt đó BẮT ĐẦU
   * chạy (không phải lúc hẹn giờ): khi LLM đang bận hoặc chờ quota, bình luận mới
   * dồn vào cùng một lô lớn hơn thay vì sinh thêm lần gọi LLM.
   */
  flush(sessionId: string): Promise<void> {
    const slot = this.pending.get(sessionId);
    if (slot?.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => {
      const current = this.pending.get(sessionId);
      if (!current?.comments.length) return;
      const batch = current.comments.splice(0, this.maxBatch);
      if (current.comments.length === 0) {
        this.pending.delete(sessionId);
        if (current.timer) clearTimeout(current.timer);
      } else {
        void this.flush(sessionId); // phần dư: lượt kế tiếp
      }
      return this.processBatch(sessionId, batch);
    });
    this.chains.set(sessionId, next);
    return next;
  }

  /** Chờ mọi lô của phiên xử lý xong (dùng khi kết thúc live và trong test). */
  async drain(sessionId: string): Promise<void> {
    await this.flush(sessionId);
  }

  private async processBatch(sessionId: string, batch: Comment[]): Promise<void> {
    let llmMs = 0;
    let actionCount = 0;
    let ok = false;
    try {
      const ctx = await this.gateway.getSessionContext(sessionId);
      const buyerIds = [...new Set(batch.map((c) => c.buyerExternalId))];
      const openOrders = await this.gateway.getOpenOrders(sessionId, buyerIds);
      const codeOf = new Map(ctx.catalog.map((p) => [p.id, p.code]));

      const orders: Record<string, PromptOrderLine[]> = {};
      for (const [buyer, o] of openOrders) {
        orders[buyer] = o.items.map((i) => ({ item: codeOf.get(i.productId) ?? i.productCode, size: i.size, qty: i.qty }));
      }
      const llmStart = performance.now();
      const { actions } = await extractActions(this.llm, {
        catalog: ctx.catalog,
        featured: ctx.catalog.find((p) => p.id === ctx.session.featuredProductId)?.code ?? null,
        previouslyFeatured: ctx.previouslyFeatured,
        orders,
        comments: batch.map((c) => ({ id: c.id, buyer: c.buyerExternalId, name: c.buyerName, text: c.text })),
      });

      llmMs = performance.now() - llmStart;
      actionCount = actions.length;
      const byId = new Map(batch.map((c) => [c.id, c]));
      const handled = new Set<string>();
      const resolver = createResolver(ctx.catalog, openOrders);

      for (const action of actions) {
        const comment = byId.get(action.commentId)!;
        handled.add(comment.id);
        for (const op of resolver.resolve(action)) {
          const order = await this.execute(sessionId, comment, op);
          if (order) resolver.setOrder(comment.buyerExternalId, order);
        }
      }
      // LLM không trả hành động nào = khen / chào lọt qua bộ lọc nhanh, không phải lỗi.
      for (const c of batch) if (!handled.has(c.id)) this.sink.onVerdict(sessionId, c.id, "ignored");
      ok = true;
    } catch (err) {
      for (const c of batch) this.sink.onVerdict(sessionId, c.id, "unparsed");
      this.sink.onError(sessionId, err, batch);
    } finally {
      const oldest = Math.min(...batch.map((c) => this.receivedAt.get(c.id) ?? Date.now()));
      for (const c of batch) this.receivedAt.delete(c.id);
      this.sink.onBatch?.(sessionId, { size: batch.length, llmMs, oldestWaitMs: Date.now() - oldest, actions: actionCount, ok });
    }
  }

  private async execute(sessionId: string, comment: Comment, op: Operation): Promise<Order | null> {
    const buyer: BuyerRef = { externalId: comment.buyerExternalId, name: comment.buyerName, source: comment.source };
    switch (op.kind) {
      case "add": {
        const before = await this.gateway.getOpenOrders(sessionId, [buyer.externalId]);
        const order = await this.gateway.addItem(sessionId, buyer, op.line, comment.id);
        this.sink.onOrder(sessionId, order, !before.has(buyer.externalId), comment);
        this.sink.onVerdict(sessionId, comment.id, "create", order.id);
        return order;
      }
      case "update": {
        const order = await this.gateway.updateItem(op.orderId, op.line, op.patch, comment.id);
        this.sink.onOrder(sessionId, order, false, comment);
        this.sink.onVerdict(sessionId, comment.id, "update", order.id);
        return order;
      }
      case "remove": {
        const order = await this.gateway.removeItem(op.orderId, op.line, comment.id);
        this.sink.onOrder(sessionId, order, false, comment);
        this.sink.onVerdict(sessionId, comment.id, "cancel", order.id);
        return order;
      }
      case "reply":
        this.sink.onReply(sessionId, comment, op.text, op.reason, op.meta);
        this.sink.onVerdict(sessionId, comment.id, "ask");
        return null;
      case "needs_review":
        this.sink.onNeedsReview(sessionId, comment, op);
        this.sink.onVerdict(sessionId, comment.id, "unparsed", op.orderId);
        return null;
    }
  }
}
