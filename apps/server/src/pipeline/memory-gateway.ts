import type { LiveSession, Order, OrderItem, Product } from "@livemate/shared";
import { aiLockReason, OrderLockedError, type BuyerRef, type LineRef, type OrderGateway, type SessionContext } from "./gateway.ts";

const isOpen = (order: Order) => order.status === "pending_payment" || order.status === "awaiting_confirmation";
const sameLine = (item: LineRef, line: LineRef) => item.productId === line.productId && item.size === line.size;
const stockAt = (product: Product, size: string | null) => product.stock[size ?? ""] ?? 0;

export class InMemoryOrderGateway implements OrderGateway {
  private readonly context: SessionContext;
  private readonly orders = new Map<string, Order>();

  constructor(opts: { session: LiveSession; catalog: Product[]; previouslyFeatured?: string[] }) {
    this.context = structuredClone({ ...opts, previouslyFeatured: opts.previouslyFeatured ?? [] });
  }

  setFeatured(code: string): void {
    const featured = this.requireCode(code);
    const previous = this.context.catalog.find((p) => p.id === this.context.session.featuredProductId);
    if (previous) this.context.previouslyFeatured.unshift(previous.code);
    this.context.session.featuredProductId = featured.id;
  }

  seedOrder(buyer: BuyerRef, lines: { item: string; size: string | null; qty: number }[]): Order {
    const items: OrderItem[] = [];
    for (const line of lines) {
      this.mergeLine(items, this.makeItem(this.requireCode(line.item), line.size, line.qty));
    }
    return this.addLines(buyer, items);
  }

  /** Test: giả lập người bán sửa tay / khách báo chuyển tiền. */
  patchOrder(id: string, patch: Partial<Pick<Order, "status" | "sellerEdited">>): void {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Unknown order: ${id}`);
    Object.assign(order, patch);
  }

  listOrders(): Order[] {
    return structuredClone([...this.orders.values()]);
  }

  getProduct(code: string): Product | undefined {
    return structuredClone(this.context.catalog.find((p) => p.code === code));
  }

  async getSessionContext(sessionId: string): Promise<SessionContext> {
    this.requireSession(sessionId);
    return structuredClone(this.context);
  }

  async getOpenOrders(sessionId: string, buyerExternalIds: string[]): Promise<Map<string, Order>> {
    this.requireSession(sessionId);
    const buyers = new Set(buyerExternalIds);
    const open = new Map<string, Order>();
    for (const order of this.orders.values()) {
      if (isOpen(order) && buyers.has(order.buyer.externalId)) open.set(order.buyer.externalId, order);
    }
    return structuredClone(open);
  }

  async addItem(sessionId: string, buyer: BuyerRef, line: LineRef & { qty: number }, commentId: string): Promise<Order> {
    this.requireSession(sessionId);
    const item = this.makeItem(this.requireProduct(line.productId), line.size, line.qty);
    const existing = [...this.orders.values()].find((o) => isOpen(o) && o.buyer.externalId === buyer.externalId);
    const locked = existing && aiLockReason(existing, "add");
    if (existing && locked) throw new OrderLockedError(existing.id, locked);
    return this.addLines(buyer, [item], commentId);
  }

  async updateItem(
    orderId: string,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
    commentId: string,
  ): Promise<Order> {
    const order = this.requireAiChangeable(orderId);
    const index = this.requireLineIndex(order, line);
    const old = order.items[index]!;
    const product = this.requireProduct(patch.productId ?? old.productId);
    const size = patch.size === undefined ? old.size : patch.size;
    const item = this.makeItem(product, size, patch.qty ?? old.qty);
    const released = sameLine(old, item) ? old.qty : 0;
    this.requireStock(product, item.size, item.qty - released);

    this.adjustStock(this.requireProduct(old.productId), old.size, old.qty);
    this.adjustStock(product, item.size, -item.qty);
    const other = order.items.find((existing) => existing !== old && sameLine(existing, item));
    if (other) {
      other.qty += item.qty;
      order.items.splice(index, 1);
    } else {
      order.items[index] = item;
    }
    return this.save(order, commentId);
  }

  async removeItem(orderId: string, line: LineRef | null, commentId: string): Promise<Order> {
    const order = this.requireAiChangeable(orderId);
    const removed = line === null ? order.items : order.items.splice(this.requireLineIndex(order, line), 1);
    for (const item of removed) this.adjustStock(this.requireProduct(item.productId), item.size, item.qty);
    if (line === null || order.items.length === 0) order.status = "cancelled";
    return this.save(order, commentId);
  }

  private addLines(buyer: BuyerRef, items: OrderItem[], commentId?: string): Order {
    const reservations = items.map((item) => ({ item, product: this.requireProduct(item.productId) }));
    for (const { item, product } of reservations) this.requireStock(product, item.size, item.qty);

    const order = [...this.orders.values()].find((o) => isOpen(o) && o.buyer.externalId === buyer.externalId) ?? this.newOrder(buyer);
    for (const { item, product } of reservations) {
      this.adjustStock(product, item.size, -item.qty);
      this.mergeLine(order.items, item);
    }
    return this.save(order, commentId);
  }

  private newOrder(buyer: BuyerRef): Order {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      code: `A${this.orders.size + 1}`,
      sessionId: this.context.session.id,
      buyer: { id: crypto.randomUUID(), externalId: buyer.externalId, displayName: buyer.name, source: buyer.source },
      items: [],
      total: 0,
      status: "pending_payment",
      publicToken: crypto.randomUUID(),
      sourceCommentIds: [],
      sellerEdited: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  private save(order: Order, commentId?: string): Order {
    order.total = order.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    if (commentId !== undefined) order.sourceCommentIds.push(commentId);
    if (this.orders.has(order.id)) {
      order.updatedAt = new Date(Math.max(Date.now(), Date.parse(order.updatedAt) + 1)).toISOString();
    }
    this.orders.set(order.id, order);
    return structuredClone(order);
  }

  private mergeLine(items: OrderItem[], item: OrderItem): void {
    const existing = items.find((line) => sameLine(line, item));
    if (existing) existing.qty += item.qty;
    else items.push(item);
  }

  private makeItem(product: Product, size: string | null, qty: number): OrderItem {
    const validSize = product.sizes.length === 0 ? size === null : size !== null && product.sizes.includes(size);
    if (!validSize) throw new Error(`Invalid size for ${product.code}: ${size}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity: ${qty}`);
    return { productId: product.id, productCode: product.code, productName: product.name, size, qty, unitPrice: product.price };
  }

  private requireStock(product: Product, size: string | null, qty: number): void {
    if (stockAt(product, size) < qty) throw new Error(`Insufficient stock for ${product.code} (${size ?? "no size"})`);
  }

  private adjustStock(product: Product, size: string | null, delta: number): void {
    product.stock[size ?? ""] = stockAt(product, size) + delta;
  }

  private requireCode(code: string): Product {
    const product = this.context.catalog.find((p) => p.code === code);
    if (!product) throw new Error(`Unknown product code: ${code}`);
    return product;
  }

  private requireProduct(id: string): Product {
    const product = this.context.catalog.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product id: ${id}`);
    return product;
  }

  private requireSession(id: string): void {
    if (id !== this.context.session.id) throw new Error(`Unknown session: ${id}`);
  }

  private requireOpenOrder(id: string): Order {
    const order = this.orders.get(id);
    if (!order || !isOpen(order)) throw new Error(`No open order: ${id}`);
    return order;
  }

  private requireAiChangeable(id: string): Order {
    const order = this.requireOpenOrder(id);
    const locked = aiLockReason(order, "change");
    if (locked) throw new OrderLockedError(order.id, locked);
    return order;
  }

  private requireLineIndex(order: Order, line: LineRef): number {
    const index = order.items.findIndex((item) => sameLine(item, line));
    if (index === -1) throw new Error(`Missing order line: ${line.productId} (${line.size ?? "no size"})`);
    return index;
  }
}
