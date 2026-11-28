import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Comment, CommentVerdict, LiveSession, Order, OrderItem, Product, RiskAlert, Seller } from "@livemate/shared";
import { Prisma, type PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../auth/crypto.ts";
import { resolveDemoSeedConfig } from "../config/env.ts";
import { PrismaFacebookConnectionStore } from "../facebook/prisma-store.ts";
import type { LineRef } from "../pipeline/gateway.ts";
import { mapOrderRow, mapProductRow, mapSessionRow, PrismaOrderGateway } from "../pipeline/prisma-gateway.ts";
import { PrismaBuyerHistoryStore } from "../risk/prisma-history.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import {
  computeSessionSummary,
  evaluateOrderTransition,
  isOpenStatus,
  normalizeProductData,
  parseStockJson,
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

interface RawProductRow {
  id: string;
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: unknown;
}

const sameLine = (a: LineRef, b: LineRef) => a.productId === b.productId && a.size === b.size;
const stockAt = (stock: Record<string, number>, size: string | null) => stock[size ?? ""] ?? 0;

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export class PrismaBackendStore implements BackendStore {
  readonly gateway: PrismaOrderGateway;
  readonly buyerHistory: PrismaBuyerHistoryStore;
  readonly facebookStore: PrismaFacebookConnectionStore;

  constructor(private readonly prisma: PrismaClient) {
    this.gateway = new PrismaOrderGateway(prisma);
    this.buyerHistory = new PrismaBuyerHistoryStore(prisma);
    this.facebookStore = new PrismaFacebookConnectionStore(prisma);
  }

  async ensureDemoSeed(catalog: Product[]): Promise<{ seller: Seller; session: LiveSession }> {
    const { email, password, explicitPassword } = resolveDemoSeedConfig(process.env);

    const byEmail = await this.prisma.seller.findUnique({ where: { email } });
    if (byEmail && byEmail.id !== "seller_demo") {
      throw new ConflictError(`Email tài khoản demo (${email}) bị trùng với tài khoản khác`);
    }

    let sellerRow = await this.prisma.seller.findUnique({ where: { id: "seller_demo" } });
    if (!sellerRow) {
      const passwordHash = await bcrypt.hash(password, 10);
      try {
        sellerRow = await this.prisma.seller.create({
          data: {
            id: "seller_demo",
            email,
            passwordHash,
            displayName: "Shop Demo",
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const racedByEmail = await this.prisma.seller.findUnique({ where: { email } });
        if (racedByEmail && racedByEmail.id !== "seller_demo") {
          throw new ConflictError(`Email tài khoản demo (${email}) bị trùng với tài khoản khác`);
        }
        sellerRow = await this.prisma.seller.findUniqueOrThrow({ where: { id: "seller_demo" } });
      }
    } else {
      const emailChanged = sellerRow.email !== email;
      const passwordChanged = explicitPassword && !(await bcrypt.compare(password, sellerRow.passwordHash));
      if (emailChanged || passwordChanged) {
        const nextHash = passwordChanged ? await bcrypt.hash(password, 10) : undefined;
        try {
          sellerRow = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.seller.update({
              where: { id: sellerRow!.id },
              data: {
                ...(emailChanged ? { email } : {}),
                ...(nextHash ? { passwordHash: nextHash } : {}),
              },
            });
            if (passwordChanged) {
              await tx.authSession.deleteMany({ where: { sellerId: sellerRow!.id } });
            }
            return updated;
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictError(`Email tài khoản demo (${email}) bị trùng với tài khoản khác`);
          }
          throw err;
        }
      }
    }

    let sessionRow = await this.prisma.liveSession.findUnique({ where: { roomCode: "DEMO" } });
    if (sessionRow && sessionRow.sellerId !== sellerRow.id) {
      throw new ConflictError(`Phòng DEMO đã thuộc về người bán khác (${sessionRow.sellerId})`);
    }
    if (!sessionRow) {
      try {
        sessionRow = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.liveSession.findUnique({ where: { roomCode: "DEMO" } });
          if (existing) {
            if (existing.sellerId !== sellerRow.id) {
              throw new ConflictError(`Phòng DEMO đã thuộc về người bán khác (${existing.sellerId})`);
            }
            return existing;
          }
          const created = await tx.liveSession.create({
            data: {
              id: "s_demo",
              roomCode: "DEMO",
              sellerId: sellerRow.id,
              status: "live",
              featuredProductId: catalog[0]?.id ?? null,
            },
          });
          if (catalog.length > 0) {
            await tx.product.createMany({
              data: catalog.map((p) => ({
                id: p.id,
                sessionId: created.id,
                code: p.code,
                name: p.name,
                sizes: [...p.sizes],
                price: p.price,
                stock: p.stock as Prisma.InputJsonValue,
              })),
              skipDuplicates: true,
            });
          }
          return created;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        sessionRow = await this.prisma.liveSession.findUniqueOrThrow({ where: { roomCode: "DEMO" } });
        if (sessionRow.sellerId !== sellerRow.id) {
          throw new ConflictError(`Phòng DEMO đã thuộc về người bán khác (${sessionRow.sellerId})`);
        }
      }
    }

    return {
      seller: { id: sellerRow.id, email: sellerRow.email, displayName: sellerRow.displayName },
      session: mapSessionRow(sessionRow),
    };
  }

  async createSeller(input: { email: string; passwordHash: string; displayName: string }): Promise<Seller> {
    const email = input.email.trim().toLowerCase();
    try {
      const row = await this.prisma.seller.create({
        data: {
          email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
        },
      });
      return { id: row.id, email: row.email, displayName: row.displayName };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Email đã được đăng ký");
      throw err;
    }
  }

  async findSellerByEmail(email: string): Promise<(Seller & { passwordHash: string }) | null> {
    const row = await this.prisma.seller.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.displayName, passwordHash: row.passwordHash };
  }

  async findSellerById(id: string): Promise<Seller | null> {
    const row = await this.prisma.seller.findUnique({ where: { id } });
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.displayName };
  }

  async createAuthSession(sellerId: string, tokenHash: string, expiresAt: Date): Promise<AuthSessionRecord> {
    const row = await this.prisma.authSession.create({
      data: { sellerId, tokenHash, expiresAt },
    });
    return { id: row.id, sellerId: row.sellerId, expiresAt: row.expiresAt };
  }

  async findAuthSessionByTokenHash(tokenHash: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null> {
    const row = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { seller: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.authSession.deleteMany({ where: { id: row.id } });
      return null;
    }
    return {
      session: { id: row.id, sellerId: row.sellerId, expiresAt: row.expiresAt },
      seller: { id: row.seller.id, email: row.seller.email, displayName: row.seller.displayName },
    };
  }

  async findAuthSessionById(sessionId: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null> {
    const row = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { seller: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.authSession.deleteMany({ where: { id: row.id } });
      return null;
    }
    return {
      session: { id: row.id, sellerId: row.sellerId, expiresAt: row.expiresAt },
      seller: { id: row.seller.id, email: row.seller.email, displayName: row.seller.displayName },
    };
  }

  async deleteAuthSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { tokenHash } });
  }

  async listSessionsBySeller(sellerId: string): Promise<LiveSession[]> {
    const rows = await this.prisma.liveSession.findMany({
      where: { sellerId },
      orderBy: { startedAt: "desc" },
    });
    return rows.map(mapSessionRow);
  }

  async createSession(sellerId: string, opts?: { roomCode?: string; seedCatalog?: Product[] }): Promise<LiveSession> {
    const explicit = opts?.roomCode?.trim().toUpperCase();
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomCode = explicit || randomRoomCode();
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const session = await tx.liveSession.create({
            data: { sellerId, roomCode, status: "live" },
          });
          if (opts?.seedCatalog?.length) {
            const products = opts.seedCatalog.map((p) => ({
              id: randomUUID(),
              sessionId: session.id,
              code: p.code,
              name: p.name,
              sizes: [...p.sizes],
              price: p.price,
              stock: p.stock as Prisma.InputJsonValue,
            }));
            await tx.product.createMany({ data: products });
            return tx.liveSession.update({
              where: { id: session.id },
              data: { featuredProductId: products[0]?.id ?? null },
            });
          }
          return session;
        });
        return mapSessionRow(created);
      } catch (err) {
        if (isUniqueViolation(err)) {
          if (explicit) throw new ConflictError("Mã phòng đã tồn tại");
          continue;
        }
        throw err;
      }
    }
    throw new Error("Không thể tạo mã phòng mới");
  }

  async getSessionById(sessionId: string): Promise<LiveSession | null> {
    const row = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    return row ? mapSessionRow(row) : null;
  }

  async getSessionByRoomCode(roomCode: string): Promise<LiveSession | null> {
    const row = await this.prisma.liveSession.findUnique({ where: { roomCode } });
    return row ? mapSessionRow(row) : null;
  }

  async findActiveSessionForSeller(sellerId: string): Promise<LiveSession | null> {
    const row = await this.prisma.liveSession.findFirst({
      where: { sellerId, status: "live" },
      orderBy: { startedAt: "desc" },
    });
    return row ? mapSessionRow(row) : null;
  }

  async endSession(sessionId: string): Promise<LiveSession> {
    const row = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!row) throw new NotFoundError("Không tìm thấy phiên live");
    if (row.status === "ended") return mapSessionRow(row);
    const updated = await this.prisma.liveSession.update({
      where: { id: sessionId },
      data: { status: "ended", endedAt: new Date() },
    });
    return mapSessionRow(updated);
  }

  async setFeaturedProduct(sessionId: string, productId: string | null): Promise<{ session: LiveSession; product: Product | null }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${sessionId} FOR UPDATE`;
      const session = await tx.liveSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundError("Không tìm thấy phiên live");

      let nextProduct: Product | null = null;
      if (productId !== null) {
        const p = await tx.product.findFirst({ where: { id: productId, sessionId } });
        if (!p) throw new NotFoundError("Không tìm thấy sản phẩm trong phiên này");
        nextProduct = mapProductRow(p);
      }

      const previouslyFeatured = [...session.previouslyFeatured];
      if (session.featuredProductId && session.featuredProductId !== productId) {
        const prev = await tx.product.findUnique({ where: { id: session.featuredProductId } });
        if (prev) previouslyFeatured.unshift(prev.code);
      }

      const updated = await tx.liveSession.update({
        where: { id: sessionId },
        data: { featuredProductId: productId, previouslyFeatured },
      });
      return { session: mapSessionRow(updated), product: nextProduct };
    });
  }

  async setFeaturedProductByCode(sessionId: string, code: string): Promise<{ session: LiveSession; product: Product }> {
    const product = await this.prisma.product.findFirst({
      where: { sessionId, code: code.trim().toUpperCase() },
    });
    if (!product) throw new NotFoundError("Không có mã này");
    const res = await this.setFeaturedProduct(sessionId, product.id);
    return { session: res.session, product: res.product! };
  }

  async updateSessionFacebook(
    sessionId: string,
    facebookObjectId: string | null,
    facebookPageId: string | null,
  ): Promise<LiveSession> {
    const existing = await this.prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!existing) throw new NotFoundError("Không tìm thấy phiên live");
    const updated = await this.prisma.liveSession.update({
      where: { id: sessionId },
      data: { facebookObjectId, facebookPageId },
    });
    return mapSessionRow(updated);
  }

  async listProducts(sessionId: string): Promise<Product[]> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const rows = await this.prisma.product.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: "asc" }, { code: "asc" }],
    });
    return rows.map(mapProductRow);
  }

  async getProductById(sessionId: string, productId: string): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({ where: { id: productId, sessionId } });
    return row ? mapProductRow(row) : null;
  }

  async createProduct(sessionId: string, input: ProductCreateInput): Promise<Product> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const normalized = normalizeProductData(input);
    try {
      const row = await this.prisma.product.create({
        data: {
          sessionId,
          code: normalized.code,
          name: normalized.name,
          sizes: normalized.sizes,
          price: normalized.price,
          stock: normalized.stock as Prisma.InputJsonValue,
        },
      });
      return mapProductRow(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`Mã sản phẩm ${normalized.code} đã tồn tại trong phiên này`);
      }
      throw err;
    }
  }

  async updateProduct(sessionId: string, productId: string, patch: ProductPatchInput): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LiveSession" WHERE id = ${sessionId} FOR UPDATE
      `;
      if (sessionRows.length === 0) throw new NotFoundError("Không tìm thấy phiên live");

      const existingRows = await tx.$queryRaw<RawProductRow[]>`
        SELECT id, code, name, sizes, price, stock
        FROM "Product"
        WHERE id = ${productId} AND "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const existing = existingRows[0];
      if (!existing) throw new NotFoundError("Không tìm thấy sản phẩm");

      const normalized = normalizeProductData({
        code: patch.code ?? existing.code,
        name: patch.name ?? existing.name,
        sizes: patch.sizes ?? existing.sizes,
        price: patch.price ?? existing.price,
        stock: patch.stock ?? parseStockJson(existing.stock),
      });
      try {
        const updated = await tx.product.update({
          where: { id: existing.id },
          data: {
            code: normalized.code,
            name: normalized.name,
            sizes: normalized.sizes,
            price: normalized.price,
            ...(patch.stock !== undefined || patch.sizes !== undefined
              ? { stock: normalized.stock as Prisma.InputJsonValue }
              : {}),
          },
        });
        return mapProductRow(updated);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(`Mã sản phẩm ${normalized.code} đã tồn tại trong phiên này`);
        }
        throw err;
      }
    });
  }

  async deleteProduct(sessionId: string, productId: string): Promise<{ sessionUpdated?: LiveSession }> {
    return this.prisma.$transaction(async (tx) => {
      const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LiveSession" WHERE id = ${sessionId} FOR UPDATE
      `;
      if (sessionRows.length === 0) throw new NotFoundError("Không tìm thấy phiên live");

      const existingRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Product" WHERE id = ${productId} AND "sessionId" = ${sessionId} FOR UPDATE
      `;
      if (existingRows.length === 0) throw new NotFoundError("Không tìm thấy sản phẩm");

      const refCount = await tx.orderItem.count({
        where: { productId, order: { sessionId } },
      });
      if (refCount > 0) {
        throw new ConflictError("Không thể xóa sản phẩm đã có trong đơn hàng");
      }

      await tx.product.delete({ where: { id: productId } });
      const session = await tx.liveSession.findUnique({ where: { id: sessionId } });
      if (session && session.featuredProductId === productId) {
        const updatedSession = await tx.liveSession.update({
          where: { id: sessionId },
          data: { featuredProductId: null },
        });
        return { sessionUpdated: mapSessionRow(updatedSession) };
      }
      return {};
    });
  }

  async saveComment(comment: Comment): Promise<void> {
    await this.prisma.comment.create({
      data: {
        id: comment.id,
        sessionId: comment.sessionId,
        source: comment.source,
        externalId: comment.externalId ?? null,
        buyerExternalId: comment.buyerExternalId,
        buyerName: comment.buyerName,
        text: comment.text,
        createdAt: new Date(comment.createdAt),
      },
    });
  }

  async updateCommentVerdict(commentId: string, verdict: CommentVerdict, orderId?: string): Promise<void> {
    await this.prisma.comment.updateMany({
      where: { id: commentId },
      data: { verdict, verdictOrderId: orderId ?? null },
    });
  }

  async listComments(sessionId: string): Promise<Comment[]> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const rows = await this.prisma.comment.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      source: r.source,
      ...(r.externalId ? { externalId: r.externalId } : {}),
      buyerExternalId: r.buyerExternalId,
      buyerName: r.buyerName,
      text: r.text,
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ...(r.verdictOrderId ? { verdictOrderId: r.verdictOrderId } : {}),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async saveRiskAlert(alert: RiskAlert): Promise<void> {
    await this.prisma.riskAlert.upsert({
      where: { id: alert.id },
      create: {
        id: alert.id,
        sessionId: alert.sessionId,
        orderId: alert.orderId,
        buyerExternalId: alert.buyerExternalId,
        kind: alert.kind,
        severity: alert.severity,
        message: alert.message,
        createdAt: new Date(alert.createdAt),
      },
      update: {},
    });
  }

  async listRiskAlerts(sessionId: string): Promise<RiskAlert[]> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const rows = await this.prisma.riskAlert.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      orderId: r.orderId,
      buyerExternalId: r.buyerExternalId,
      kind: r.kind,
      severity: r.severity,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async joinRoomAsBuyer(
    sessionId: string,
    input: { displayName?: string; buyerToken?: string },
  ): Promise<{ buyerToken: string; capability: BuyerCapabilityRecord; order: Order | null }> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phòng live");

    const trimmedName = input.displayName?.trim().slice(0, 60);
    if (input.buyerToken) {
      const cap = await this.prisma.buyerCapability.findUnique({ where: { tokenHash: hashToken(input.buyerToken) } });
      if (cap && cap.sessionId === sessionId) {
        const updatedCap = trimmedName
          ? await this.prisma.buyerCapability.update({
              where: { id: cap.id },
              data: { displayName: trimmedName },
            })
          : cap;
        const ownOrder = await this.findBuyerOrderInSession(sessionId, updatedCap.buyerExternalId);
        return {
          buyerToken: input.buyerToken,
          capability: {
            id: updatedCap.id,
            sessionId: updatedCap.sessionId,
            buyerExternalId: updatedCap.buyerExternalId,
            displayName: updatedCap.displayName,
          },
          order: ownOrder,
        };
      }
    }

    if (!trimmedName) {
      throw new ValidationError("Vui lòng nhập tên hiển thị");
    }

    const buyerToken = generateToken(24);
    const created = await this.prisma.buyerCapability.create({
      data: {
        sessionId,
        tokenHash: hashToken(buyerToken),
        buyerExternalId: `rb_${randomUUID()}`,
        displayName: trimmedName,
      },
    });
    return {
      buyerToken,
      capability: {
        id: created.id,
        sessionId: created.sessionId,
        buyerExternalId: created.buyerExternalId,
        displayName: created.displayName,
      },
      order: null,
    };
  }

  async resolveBuyerCapability(sessionId: string, buyerToken: string): Promise<BuyerCapabilityRecord | null> {
    const cap = await this.prisma.buyerCapability.findUnique({
      where: { tokenHash: hashToken(buyerToken) },
    });
    if (!cap || cap.sessionId !== sessionId) return null;
    return {
      id: cap.id,
      sessionId: cap.sessionId,
      buyerExternalId: cap.buyerExternalId,
      displayName: cap.displayName,
    };
  }

  async listOrdersBySession(sessionId: string): Promise<Order[]> {
    const session = await this.prisma.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const rows = await this.prisma.order.findMany({
      where: { sessionId },
      include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapOrderRow);
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    return row ? mapOrderRow(row) : null;
  }

  async getOrderByPublicToken(publicToken: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({
      where: { publicToken },
      include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    return row ? mapOrderRow(row) : null;
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    const session = await this.getSessionById(sessionId);
    if (!session) throw new NotFoundError("Không tìm thấy phiên live");
    const orders = await this.listOrdersBySession(sessionId);
    return computeSessionSummary(session, orders);
  }

  async sellerPatchOrderItem(
    sessionId: string,
    orderId: string,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LiveSession" WHERE id = ${sessionId} FOR UPDATE
      `;
      if (sessionRows.length === 0) throw new NotFoundError("Không tìm thấy phiên live");
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!order || order.sessionId !== sessionId) throw new NotFoundError("Không tìm thấy đơn hàng");
      if (!isOpenStatus(order.status)) {
        throw new ConflictError(`Không thể sửa đơn ở trạng thái ${order.status}`);
      }

      const old = order.items.find((item) => sameLine(item, line));
      if (!old) throw new NotFoundError("Không tìm thấy dòng sản phẩm trong đơn hàng");

      const targetProductId = patch.productId ?? old.productId;
      const uniqueIds = [...new Set([old.productId, targetProductId])].sort();
      const locked = new Map<string, Product>();
      for (const id of uniqueIds) {
        const rows = await tx.$queryRaw<RawProductRow[]>`
          SELECT id, code, name, sizes, price, stock
          FROM "Product"
          WHERE id = ${id} AND "sessionId" = ${sessionId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (row) locked.set(id, mapProductRow(row));
      }

      const oldProduct = locked.get(old.productId);
      const targetProduct = locked.get(targetProductId);
      if (!oldProduct || !targetProduct) throw new NotFoundError("Không tìm thấy sản phẩm trong phiên");

      const nextSize = patch.size === undefined ? old.size : patch.size;
      const nextQty = patch.qty ?? old.qty;
      const validSize = targetProduct.sizes.length === 0
        ? nextSize === null
        : nextSize !== null && targetProduct.sizes.includes(nextSize);
      if (!validSize) throw new ValidationError(`Size không hợp lệ cho ${targetProduct.code}`);
      if (!Number.isInteger(nextQty) || nextQty <= 0) throw new ValidationError("Số lượng phải là số nguyên dương");

      const nextItem: OrderItem = {
        productId: targetProduct.id,
        productCode: targetProduct.code,
        productName: targetProduct.name,
        size: nextSize,
        qty: nextQty,
        unitPrice: targetProduct.price,
      };
      const released = sameLine(old, nextItem) ? old.qty : 0;
      if (stockAt(targetProduct.stock, nextItem.size) < nextItem.qty - released) {
        throw new ConflictError(`Không đủ tồn kho cho ${targetProduct.code}`);
      }

      if (oldProduct.id === targetProduct.id) {
        const stock = { ...oldProduct.stock };
        stock[old.size ?? ""] = stockAt(stock, old.size) + old.qty;
        stock[nextItem.size ?? ""] = stockAt(stock, nextItem.size) - nextItem.qty;
        await tx.product.update({
          where: { id: oldProduct.id },
          data: { stock: stock as Prisma.InputJsonValue },
        });
      } else {
        const oldStock = { ...oldProduct.stock, [old.size ?? ""]: stockAt(oldProduct.stock, old.size) + old.qty };
        const targetStock = {
          ...targetProduct.stock,
          [nextItem.size ?? ""]: stockAt(targetProduct.stock, nextItem.size) - nextItem.qty,
        };
        await tx.product.update({
          where: { id: oldProduct.id },
          data: { stock: oldStock as Prisma.InputJsonValue },
        });
        await tx.product.update({
          where: { id: targetProduct.id },
          data: { stock: targetStock as Prisma.InputJsonValue },
        });
      }

      const other = order.items.find((existing) => existing.id !== old.id && sameLine(existing, nextItem));
      if (other) {
        await tx.orderItem.update({
          where: { id: other.id },
          data: { qty: other.qty + nextItem.qty },
        });
        await tx.orderItem.delete({ where: { id: old.id } });
      } else {
        await tx.orderItem.update({
          where: { id: old.id },
          data: {
            productId: nextItem.productId,
            productCode: nextItem.productCode,
            productName: nextItem.productName,
            size: nextItem.size,
            qty: nextItem.qty,
            unitPrice: nextItem.unitPrice,
          },
        });
      }

      const updatedItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        orderBy: { sortOrder: "asc" },
      });
      const total = updatedItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          total,
          sellerEdited: true,
          updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)),
        },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      return mapOrderRow(updated);
    });
  }

  async transitionOrderById(orderId: string, action: OrderActionKind): Promise<OrderTransitionOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const meta = await tx.order.findUnique({ where: { id: orderId }, select: { sessionId: true } });
      if (!meta) throw new NotFoundError("Không tìm thấy đơn hàng");
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${meta.sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const orderRow = await tx.order.findUnique({
        where: { id: orderId },
        include: { session: true, buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!orderRow) throw new NotFoundError("Không tìm thấy đơn hàng");
      return this.applyTransitionTx(tx, orderRow, action);
    });
  }

  async transitionOrderByPublicToken(publicToken: string, action: "report_payment"): Promise<OrderTransitionOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const meta = await tx.order.findUnique({ where: { publicToken }, select: { sessionId: true } });
      if (!meta) throw new NotFoundError("Không tìm thấy đơn hàng");
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${meta.sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Order" WHERE "publicToken" = ${publicToken} FOR UPDATE`;
      const orderRow = await tx.order.findUnique({
        where: { publicToken },
        include: { session: true, buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!orderRow) throw new NotFoundError("Không tìm thấy đơn hàng");
      return this.applyTransitionTx(tx, orderRow, action);
    });
  }

  private async applyTransitionTx(
    tx: Prisma.TransactionClient,
    orderRow: Prisma.OrderGetPayload<{ include: { session: true; buyer: true; items: true } }>,
    action: OrderActionKind,
  ): Promise<OrderTransitionOutcome> {
    const previousStatus = orderRow.status;
    const res = evaluateOrderTransition(previousStatus, action);

    if (res.restoreStock) {
      const productIds = [...new Set(orderRow.items.map((i) => i.productId))].sort();
      const lockedStocks = new Map<string, Record<string, number>>();
      for (const pid of productIds) {
        const rows = await tx.$queryRaw<RawProductRow[]>`
          SELECT id, code, name, sizes, price, stock
          FROM "Product"
          WHERE id = ${pid} AND "sessionId" = ${orderRow.sessionId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (row) lockedStocks.set(pid, parseStockJson(row.stock));
      }
      for (const item of orderRow.items) {
        const stock = lockedStocks.get(item.productId);
        if (!stock) continue;
        stock[item.size ?? ""] = stockAt(stock, item.size) + item.qty;
      }
      for (const [pid, stock] of lockedStocks) {
        await tx.product.update({
          where: { id: pid },
          data: { stock: stock as Prisma.InputJsonValue },
        });
      }
    }

    const updated = res.changed
      ? await tx.order.update({
          where: { id: orderRow.id },
          data: {
            status: res.nextStatus,
            ...(res.sellerEdited !== undefined ? { sellerEdited: res.sellerEdited } : {}),
            updatedAt: new Date(Math.max(Date.now(), orderRow.updatedAt.getTime() + 1)),
          },
          include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
        })
      : orderRow;

    return {
      order: mapOrderRow(updated),
      previousStatus,
      changed: res.changed,
      session: mapSessionRow(orderRow.session),
    };
  }

  private async findBuyerOrderInSession(sessionId: string, buyerExternalId: string): Promise<Order | null> {
    const rows = await this.prisma.order.findMany({
      where: {
        sessionId,
        buyer: { externalId: buyerExternalId },
        status: { not: "cancelled" },
      },
      include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const open = rows.find((r) => isOpenStatus(r.status));
    const chosen = open ?? rows[0];
    return chosen ? mapOrderRow(chosen) : null;
  }
}
