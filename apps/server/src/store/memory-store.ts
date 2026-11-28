import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Comment, CommentVerdict, LiveSession, Order, OrderItem, Product, RiskAlert, Seller } from "@livemate/shared";
import { generateToken, hashToken } from "../auth/crypto.ts";
import { resolveDemoSeedConfig } from "../config/env.ts";
import { InMemoryFacebookConnectionStore } from "../facebook/store.ts";
import type { LineRef, OrderGateway, SessionContext } from "../pipeline/gateway.ts";
import { InMemoryBuyerHistoryStore } from "../risk/history.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import {
  cloneProduct,
  computeSessionSummary,
  evaluateOrderTransition,
  isOpenStatus,
  normalizeProductData,
  type OrderActionKind,
  type SessionSummary,
} from "./transitions.ts";
import type {
  AuthSessionRecord,
  BackendStore,
  BuyerCapabilityRecord,
  OrderTransitionOutcome,
  ProductCreateInput,
  ProductPatchInput,
} from "./types.ts";

interface SessionBucket {
  session: LiveSession;
  previouslyFeatured: string[];
  catalog: Product[];
  orders: Map<string, Order>;
  comments: Comment[];
  riskAlerts: RiskAlert[];
  nextOrderSeq: number;
}

const sameLine = (a: LineRef, b: LineRef) => a.productId === b.productId && a.size === b.size;
const stockAt = (p: Product, size: string | null) => p.stock[size ?? ""] ?? 0;

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return code;
}

export class MemoryBackendStore implements BackendStore {
  readonly buyerHistory: InMemoryBuyerHistoryStore;
  readonly facebookStore = new InMemoryFacebookConnectionStore();
  readonly gateway: OrderGateway;

  private readonly sellers = new Map<string, Seller & { passwordHash: string }>();
  private readonly sellerByEmail = new Map<string, string>();
  private readonly authSessions = new Map<string, AuthSessionRecord & { tokenHash: string }>();
  private readonly authSessionByTokenHash = new Map<string, string>();

  private readonly buckets = new Map<string, SessionBucket>();
  private readonly sessionIdByRoom = new Map<string, string>();
  private readonly sessionIdByOrderId = new Map<string, string>();
  private readonly orderIdByToken = new Map<string, string>();
  private readonly capabilitiesByTokenHash = new Map<string, BuyerCapabilityRecord>();
  private readonly commentById = new Map<string, Comment>();

  constructor(opts: { buyerHistorySeed?: Record<string, { boomed: number; completed: number }> } = {}) {
    this.buyerHistory = new InMemoryBuyerHistoryStore(opts.buyerHistorySeed ?? {});
    this.gateway = this.createGateway();
  }

  private createGateway(): OrderGateway {
    return {
      getSessionContext: async (sessionId) => {
        const b = this.requireBucket(sessionId);
        return structuredClone({
          session: b.session,
          catalog: b.catalog,
          previouslyFeatured: b.previouslyFeatured,
        }) satisfies SessionContext;
      },
      getOpenOrders: async (sessionId, buyerExternalIds) => {
        const b = this.requireBucket(sessionId);
        const wanted = new Set(buyerExternalIds);
        const open = new Map<string, Order>();
        for (const order of b.orders.values()) {
          if (isOpenStatus(order.status) && wanted.has(order.buyer.externalId)) {
            open.set(order.buyer.externalId, structuredClone(order));
          }
        }
        return open;
      },
      addItem: async (sessionId, buyer, line, commentId) => {
        const b = this.requireBucket(sessionId);
        const product = this.requireProductInBucket(b, line.productId);
        const item = this.makeOrderItem(product, line.size, line.qty);
        this.requireStock(product, item.size, item.qty);

        let order = [...b.orders.values()].find((o) => isOpenStatus(o.status) && o.buyer.externalId === buyer.externalId);
        if (!order) {
          const now = new Date().toISOString();
          b.nextOrderSeq += 1;
          order = {
            id: randomUUID(),
            code: `A${b.nextOrderSeq}`,
            sessionId: b.session.id,
            buyer: { id: randomUUID(), externalId: buyer.externalId, displayName: buyer.name, source: buyer.source },
            items: [],
            total: 0,
            status: "pending_payment",
            publicToken: randomUUID(),
            sourceCommentIds: [],
            sellerEdited: false,
            createdAt: now,
            updatedAt: now,
          };
          b.orders.set(order.id, order);
          this.sessionIdByOrderId.set(order.id, b.session.id);
          this.orderIdByToken.set(order.publicToken, order.id);
        }

        product.stock[item.size ?? ""] = stockAt(product, item.size) - item.qty;
        const existing = order.items.find((i) => sameLine(i, item));
        if (existing) existing.qty += item.qty;
        else order.items.push(item);

        return this.saveOrderInBucket(b, order, commentId);
      },
      updateItem: async (orderId, line, patch, commentId) => {
        const { bucket, order } = this.requireOpenOrderById(orderId);
        return this.applyOrderItemPatch(bucket, order, line, patch, { commentId });
      },
      removeItem: async (orderId, line, commentId) => {
        const { bucket, order } = this.requireOpenOrderById(orderId);
        const index = line === null ? -1 : order.items.findIndex((i) => sameLine(i, line));
        if (line !== null && index === -1) {
          throw new Error(`Missing order line: ${line.productId} (${line.size ?? "no size"})`);
        }
        const removed = line === null ? order.items : order.items.splice(index, 1);
        for (const item of removed) {
          const p = bucket.catalog.find((c) => c.id === item.productId);
          if (p) p.stock[item.size ?? ""] = stockAt(p, item.size) + item.qty;
        }
        if (line === null || order.items.length === 0) order.status = "cancelled";
        return this.saveOrderInBucket(bucket, order, commentId);
      },
    };
  }

  async ensureDemoSeed(catalog: Product[]): Promise<{ seller: Seller; session: LiveSession }> {
    const { email, password, explicitPassword } = resolveDemoSeedConfig(process.env);

    let sellerRecord = this.sellers.get("seller_demo");
    const collidingId = this.sellerByEmail.get(email);
    if (collidingId && collidingId !== "seller_demo") {
      throw new ConflictError(`Email tài khoản demo (${email}) bị trùng với tài khoản khác`);
    }

    if (!sellerRecord) {
      const passwordHash = await bcrypt.hash(password, 8);
      sellerRecord = {
        id: "seller_demo",
        email,
        displayName: "Shop Demo",
        passwordHash,
      };
      this.sellers.set(sellerRecord.id, sellerRecord);
      this.sellerByEmail.set(email, sellerRecord.id);
    } else {
      if (sellerRecord.email !== email) {
        this.sellerByEmail.delete(sellerRecord.email);
        sellerRecord.email = email;
        this.sellerByEmail.set(email, sellerRecord.id);
      }
      if (explicitPassword && !(await bcrypt.compare(password, sellerRecord.passwordHash))) {
        sellerRecord.passwordHash = await bcrypt.hash(password, 8);
        for (const [authId, auth] of this.authSessions) {
          if (auth.sellerId === sellerRecord.id) {
            this.authSessions.delete(authId);
            this.authSessionByTokenHash.delete(auth.tokenHash);
          }
        }
      }
    }

    const existingSessionId = this.sessionIdByRoom.get("DEMO");
    let bucket = existingSessionId ? this.buckets.get(existingSessionId) : undefined;
    if (bucket && bucket.session.sellerId !== sellerRecord.id) {
      throw new ConflictError(`Phòng DEMO đã thuộc về người bán khác (${bucket.session.sellerId})`);
    }
    if (!bucket) {
      const clonedCatalog = catalog.map(cloneProduct);
      const session: LiveSession = {
        id: "s_demo",
        roomCode: "DEMO",
        sellerId: sellerRecord.id,
        status: "live",
        featuredProductId: clonedCatalog[0]?.id ?? null,
        facebookObjectId: null,
        facebookPageId: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      };
      bucket = {
        session,
        previouslyFeatured: [],
        catalog: clonedCatalog,
        orders: new Map(),
        comments: [],
        riskAlerts: [],
        nextOrderSeq: 0,
      };
      this.buckets.set(session.id, bucket);
      this.sessionIdByRoom.set(session.roomCode, session.id);
    }

    const { passwordHash: _passwordHash, ...seller } = sellerRecord;
    return { seller, session: structuredClone(bucket.session) };
  }

  async createSeller(input: { email: string; passwordHash: string; displayName: string }): Promise<Seller> {
    const email = input.email.trim().toLowerCase();
    if (this.sellerByEmail.has(email)) {
      throw new ConflictError("Email đã được đăng ký");
    }
    const seller: Seller & { passwordHash: string } = {
      id: randomUUID(),
      email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
    };
    this.sellers.set(seller.id, seller);
    this.sellerByEmail.set(email, seller.id);
    return { id: seller.id, email: seller.email, displayName: seller.displayName };
  }

  async findSellerByEmail(email: string): Promise<(Seller & { passwordHash: string }) | null> {
    const id = this.sellerByEmail.get(email.trim().toLowerCase());
    if (!id) return null;
    const seller = this.sellers.get(id);
    return seller ? { ...seller } : null;
  }

  async findSellerById(id: string): Promise<Seller | null> {
    const seller = this.sellers.get(id);
    if (!seller) return null;
    return { id: seller.id, email: seller.email, displayName: seller.displayName };
  }

  async createAuthSession(sellerId: string, tokenHash: string, expiresAt: Date): Promise<AuthSessionRecord> {
    const record = { id: randomUUID(), sellerId, tokenHash, expiresAt };
    this.authSessions.set(record.id, record);
    this.authSessionByTokenHash.set(tokenHash, record.id);
    return { id: record.id, sellerId: record.sellerId, expiresAt: record.expiresAt };
  }

  async findAuthSessionByTokenHash(tokenHash: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null> {
    const id = this.authSessionByTokenHash.get(tokenHash);
    if (!id) return null;
    return this.findAuthSessionById(id);
  }

  async findAuthSessionById(sessionId: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null> {
    const record = this.authSessions.get(sessionId);
    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) {
      this.authSessions.delete(record.id);
      this.authSessionByTokenHash.delete(record.tokenHash);
      return null;
    }
    const seller = await this.findSellerById(record.sellerId);
    if (!seller) return null;
    return { session: { id: record.id, sellerId: record.sellerId, expiresAt: record.expiresAt }, seller };
  }

  async deleteAuthSessionByTokenHash(tokenHash: string): Promise<void> {
    const id = this.authSessionByTokenHash.get(tokenHash);
    if (!id) return;
    this.authSessionByTokenHash.delete(tokenHash);
    this.authSessions.delete(id);
  }

  async listSessionsBySeller(sellerId: string): Promise<LiveSession[]> {
    const list: LiveSession[] = [];
    for (const b of this.buckets.values()) {
      if (b.session.sellerId === sellerId) list.push(structuredClone(b.session));
    }
    return list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  async createSession(sellerId: string, opts?: { roomCode?: string; seedCatalog?: Product[] }): Promise<LiveSession> {
    let roomCode = opts?.roomCode?.trim().toUpperCase() || randomRoomCode();
    while (this.sessionIdByRoom.has(roomCode)) {
      if (opts?.roomCode) throw new ConflictError("Mã phòng đã tồn tại");
      roomCode = randomRoomCode();
    }
    const catalog = (opts?.seedCatalog ?? []).map((p) => ({ ...cloneProduct(p), id: randomUUID() }));
    const session: LiveSession = {
      id: randomUUID(),
      roomCode,
      sellerId,
      status: "live",
      featuredProductId: catalog[0]?.id ?? null,
      facebookObjectId: null,
      facebookPageId: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    const bucket: SessionBucket = {
      session,
      previouslyFeatured: [],
      catalog,
      orders: new Map(),
      comments: [],
      riskAlerts: [],
      nextOrderSeq: 0,
    };
    this.buckets.set(session.id, bucket);
    this.sessionIdByRoom.set(roomCode, session.id);
    return structuredClone(session);
  }

  async getSessionById(sessionId: string): Promise<LiveSession | null> {
    const b = this.buckets.get(sessionId);
    return b ? structuredClone(b.session) : null;
  }

  async getSessionByRoomCode(roomCode: string): Promise<LiveSession | null> {
    const id = this.sessionIdByRoom.get(roomCode);
    if (!id) return null;
    return this.getSessionById(id);
  }

  async findActiveSessionForSeller(sellerId: string): Promise<LiveSession | null> {
    const sessions = await this.listSessionsBySeller(sellerId);
    return sessions.find((s) => s.status === "live") ?? null;
  }

  async endSession(sessionId: string): Promise<LiveSession> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    if (b.session.status === "live") {
      b.session.status = "ended";
      b.session.endedAt = new Date().toISOString();
    }
    return structuredClone(b.session);
  }

  async setFeaturedProduct(sessionId: string, productId: string | null): Promise<{ session: LiveSession; product: Product | null }> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    let nextProduct: Product | null = null;
    if (productId !== null) {
      nextProduct = b.catalog.find((p) => p.id === productId) ?? null;
      if (!nextProduct) throw new NotFoundError("Không tìm thấy sản phẩm trong phiên này");
    }
    if (b.session.featuredProductId && b.session.featuredProductId !== productId) {
      const prev = b.catalog.find((p) => p.id === b.session.featuredProductId);
      if (prev) b.previouslyFeatured.unshift(prev.code);
    }
    b.session.featuredProductId = productId;
    return { session: structuredClone(b.session), product: nextProduct ? cloneProduct(nextProduct) : null };
  }

  async setFeaturedProductByCode(sessionId: string, code: string): Promise<{ session: LiveSession; product: Product }> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    const product = b.catalog.find((p) => p.code.toUpperCase() === code.trim().toUpperCase());
    if (!product) throw new NotFoundError("Không có mã này");
    const res = await this.setFeaturedProduct(sessionId, product.id);
    return { session: res.session, product: res.product! };
  }

  async updateSessionFacebook(
    sessionId: string,
    facebookObjectId: string | null,
    facebookPageId: string | null,
  ): Promise<LiveSession> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    b.session.facebookObjectId = facebookObjectId;
    b.session.facebookPageId = facebookPageId;
    return structuredClone(b.session);
  }

  async listProducts(sessionId: string): Promise<Product[]> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    return b.catalog.map(cloneProduct);
  }

  async getProductById(sessionId: string, productId: string): Promise<Product | null> {
    const b = this.buckets.get(sessionId);
    if (!b) return null;
    const found = b.catalog.find((p) => p.id === productId);
    return found ? cloneProduct(found) : null;
  }

  async createProduct(sessionId: string, input: ProductCreateInput): Promise<Product> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    const normalized = normalizeProductData(input);
    if (b.catalog.some((p) => p.code === normalized.code)) {
      throw new ConflictError(`Mã sản phẩm ${normalized.code} đã tồn tại trong phiên này`);
    }
    const product: Product = { id: randomUUID(), ...normalized };
    b.catalog.push(product);
    return cloneProduct(product);
  }

  async updateProduct(sessionId: string, productId: string, patch: ProductPatchInput): Promise<Product> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    const product = b.catalog.find((p) => p.id === productId);
    if (!product) throw new NotFoundError("Không tìm thấy sản phẩm");

    const normalized = normalizeProductData({
      code: patch.code ?? product.code,
      name: patch.name ?? product.name,
      sizes: patch.sizes ?? product.sizes,
      price: patch.price ?? product.price,
      stock: patch.stock ?? product.stock,
    });
    if (b.catalog.some((p) => p.id !== productId && p.code === normalized.code)) {
      throw new ConflictError(`Mã sản phẩm ${normalized.code} đã tồn tại trong phiên này`);
    }
    Object.assign(product, normalized);
    return cloneProduct(product);
  }

  async deleteProduct(sessionId: string, productId: string): Promise<{ sessionUpdated?: LiveSession }> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    const index = b.catalog.findIndex((p) => p.id === productId);
    if (index === -1) throw new NotFoundError("Không tìm thấy sản phẩm");

    const usedInOrder = [...b.orders.values()].some((o) => o.items.some((i) => i.productId === productId));
    if (usedInOrder) {
      throw new ConflictError("Không thể xóa sản phẩm đã có trong đơn hàng");
    }

    b.catalog.splice(index, 1);
    if (b.session.featuredProductId === productId) {
      b.session.featuredProductId = null;
      return { sessionUpdated: structuredClone(b.session) };
    }
    return {};
  }

  async saveComment(comment: Comment): Promise<void> {
    const b = this.buckets.get(comment.sessionId);
    if (!b) return;
    const stored = structuredClone(comment);
    b.comments.push(stored);
    this.commentById.set(stored.id, stored);
  }

  async updateCommentVerdict(commentId: string, verdict: CommentVerdict, orderId?: string): Promise<void> {
    const comment = this.commentById.get(commentId);
    if (!comment) return;
    comment.verdict = verdict;
    if (orderId !== undefined) comment.verdictOrderId = orderId;
    else delete comment.verdictOrderId;
  }

  async listComments(sessionId: string): Promise<Comment[]> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    return structuredClone(b.comments);
  }

  async saveRiskAlert(alert: RiskAlert): Promise<void> {
    const b = this.buckets.get(alert.sessionId);
    if (!b) return;
    if (b.riskAlerts.some((existing) => existing.id === alert.id)) return;
    b.riskAlerts.push(structuredClone(alert));
  }

  async listRiskAlerts(sessionId: string): Promise<RiskAlert[]> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    return structuredClone(b.riskAlerts);
  }

  async joinRoomAsBuyer(
    sessionId: string,
    input: { displayName?: string; buyerToken?: string },
  ): Promise<{ buyerToken: string; capability: BuyerCapabilityRecord; order: Order | null }> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phòng live");

    const trimmedName = input.displayName?.trim().slice(0, 60);
    if (input.buyerToken) {
      const existing = this.capabilitiesByTokenHash.get(hashToken(input.buyerToken));
      if (existing && existing.sessionId === sessionId) {
        if (trimmedName) existing.displayName = trimmedName;
        const ownOrder = this.findBuyerOrderInBucket(b, existing.buyerExternalId);
        return {
          buyerToken: input.buyerToken,
          capability: { ...existing },
          order: ownOrder ? structuredClone(ownOrder) : null,
        };
      }
    }

    if (!trimmedName) {
      throw new ValidationError("Vui lòng nhập tên hiển thị");
    }
    const buyerToken = generateToken(24);
    const capability: BuyerCapabilityRecord = {
      id: randomUUID(),
      sessionId,
      buyerExternalId: `rb_${randomUUID()}`,
      displayName: trimmedName,
    };
    this.capabilitiesByTokenHash.set(hashToken(buyerToken), capability);
    return { buyerToken, capability: { ...capability }, order: null };
  }

  async resolveBuyerCapability(sessionId: string, buyerToken: string): Promise<BuyerCapabilityRecord | null> {
    const cap = this.capabilitiesByTokenHash.get(hashToken(buyerToken));
    if (!cap || cap.sessionId !== sessionId) return null;
    return { ...cap };
  }

  async listOrdersBySession(sessionId: string): Promise<Order[]> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    return structuredClone([...b.orders.values()]);
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const sid = this.sessionIdByOrderId.get(orderId);
    if (!sid) return null;
    const order = this.buckets.get(sid)?.orders.get(orderId);
    return order ? structuredClone(order) : null;
  }

  async getOrderByPublicToken(publicToken: string): Promise<Order | null> {
    const orderId = this.orderIdByToken.get(publicToken);
    if (!orderId) return null;
    return this.getOrderById(orderId);
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    return computeSessionSummary(structuredClone(b.session), structuredClone([...b.orders.values()]));
  }

  async sellerPatchOrderItem(
    sessionId: string,
    orderId: string,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
  ): Promise<Order> {
    const b = this.buckets.get(sessionId);
    if (!b) throw new NotFoundError("Không tìm thấy phiên live");
    const order = b.orders.get(orderId);
    if (!order || order.sessionId !== sessionId) throw new NotFoundError("Không tìm thấy đơn hàng");
    if (!isOpenStatus(order.status)) throw new ConflictError(`Không thể sửa đơn ở trạng thái ${order.status}`);
    try {
      return this.applyOrderItemPatch(b, order, line, patch, { sellerEdited: true });
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : "Không thể sửa dòng đơn hàng");
    }
  }

  async transitionOrderById(orderId: string, action: OrderActionKind): Promise<OrderTransitionOutcome> {
    const sid = this.sessionIdByOrderId.get(orderId);
    if (!sid) throw new NotFoundError("Không tìm thấy đơn hàng");
    const b = this.buckets.get(sid);
    const order = b?.orders.get(orderId);
    if (!b || !order) throw new NotFoundError("Không tìm thấy đơn hàng");
    return this.applyTransition(b, order, action);
  }

  async transitionOrderByPublicToken(publicToken: string, action: "report_payment"): Promise<OrderTransitionOutcome> {
    const orderId = this.orderIdByToken.get(publicToken);
    if (!orderId) throw new NotFoundError("Không tìm thấy đơn hàng");
    return this.transitionOrderById(orderId, action);
  }

  private applyTransition(bucket: SessionBucket, order: Order, action: OrderActionKind): OrderTransitionOutcome {
    const previousStatus = order.status;
    const res = evaluateOrderTransition(previousStatus, action);
    if (res.restoreStock) {
      for (const item of order.items) {
        const product = bucket.catalog.find((p) => p.id === item.productId);
        if (product) {
          product.stock[item.size ?? ""] = stockAt(product, item.size) + item.qty;
        }
      }
    }
    if (res.changed) {
      order.status = res.nextStatus;
      if (res.sellerEdited !== undefined) order.sellerEdited = res.sellerEdited;
      order.updatedAt = new Date(Math.max(Date.now(), Date.parse(order.updatedAt) + 1)).toISOString();
    }
    return {
      order: structuredClone(order),
      previousStatus,
      changed: res.changed,
      session: structuredClone(bucket.session),
    };
  }

  private applyOrderItemPatch(
    bucket: SessionBucket,
    order: Order,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
    opts: { commentId?: string; sellerEdited?: boolean },
  ): Order {
    const index = order.items.findIndex((i) => sameLine(i, line));
    if (index === -1) throw new Error(`Missing order line: ${line.productId} (${line.size ?? "no size"})`);
    const old = order.items[index]!;
    const product = this.requireProductInBucket(bucket, patch.productId ?? old.productId);
    const size = patch.size === undefined ? old.size : patch.size;
    const item = this.makeOrderItem(product, size, patch.qty ?? old.qty);
    const released = sameLine(old, item) ? old.qty : 0;
    this.requireStock(product, item.size, item.qty - released);

    const oldProduct = this.requireProductInBucket(bucket, old.productId);
    oldProduct.stock[old.size ?? ""] = stockAt(oldProduct, old.size) + old.qty;
    product.stock[item.size ?? ""] = stockAt(product, item.size) - item.qty;

    const other = order.items.find((existing) => existing !== old && sameLine(existing, item));
    if (other) {
      other.qty += item.qty;
      order.items.splice(index, 1);
    } else {
      order.items[index] = item;
    }
    if (opts.sellerEdited) order.sellerEdited = true;
    return this.saveOrderInBucket(bucket, order, opts.commentId);
  }

  private saveOrderInBucket(bucket: SessionBucket, order: Order, commentId?: string): Order {
    order.total = order.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    if (commentId !== undefined) order.sourceCommentIds.push(commentId);
    order.updatedAt = new Date(Math.max(Date.now(), Date.parse(order.updatedAt) + 1)).toISOString();
    bucket.orders.set(order.id, order);
    return structuredClone(order);
  }

  private findBuyerOrderInBucket(bucket: SessionBucket, buyerExternalId: string): Order | null {
    const orders = [...bucket.orders.values()].filter((o) => o.buyer.externalId === buyerExternalId);
    const open = orders.find((o) => isOpenStatus(o.status));
    if (open) return open;
    const nonCancelled = orders.filter((o) => o.status !== "cancelled");
    return nonCancelled.at(-1) ?? null;
  }

  private requireBucket(sessionId: string): SessionBucket {
    const b = this.buckets.get(sessionId);
    if (!b) throw new Error(`Unknown session: ${sessionId}`);
    return b;
  }

  private requireOpenOrderById(orderId: string): { bucket: SessionBucket; order: Order } {
    const sid = this.sessionIdByOrderId.get(orderId);
    const bucket = sid ? this.buckets.get(sid) : undefined;
    const order = bucket?.orders.get(orderId);
    if (!bucket || !order || !isOpenStatus(order.status)) {
      throw new Error(`No open order: ${orderId}`);
    }
    return { bucket, order };
  }

  private requireProductInBucket(bucket: SessionBucket, productId: string): Product {
    const product = bucket.catalog.find((p) => p.id === productId);
    if (!product) throw new Error(`Unknown product id: ${productId}`);
    return product;
  }

  private makeOrderItem(product: Product, size: string | null, qty: number): OrderItem {
    const validSize = product.sizes.length === 0 ? size === null : size !== null && product.sizes.includes(size);
    if (!validSize) throw new Error(`Invalid size for ${product.code}: ${size}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity: ${qty}`);
    return { productId: product.id, productCode: product.code, productName: product.name, size, qty, unitPrice: product.price };
  }

  private requireStock(product: Product, size: string | null, qty: number): void {
    if (stockAt(product, size) < qty) throw new Error(`Insufficient stock for ${product.code} (${size ?? "no size"})`);
  }
}
