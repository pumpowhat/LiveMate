import { randomUUID } from "node:crypto";
import type { LiveSession, Order, OrderItem, Product } from "@livemate/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isOpenStatus, parseStockJson } from "../store/transitions.ts";
import type { BuyerRef, LineRef, OrderGateway, SessionContext } from "./gateway.ts";

interface RawProductRow {
  id: string;
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: unknown;
}

const sameLine = (item: LineRef, line: LineRef) => item.productId === line.productId && item.size === line.size;
const stockAt = (stock: Record<string, number>, size: string | null) => stock[size ?? ""] ?? 0;

export function mapProductRow(row: {
  id: string;
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: unknown;
}): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sizes: [...row.sizes],
    price: row.price,
    stock: parseStockJson(row.stock),
  };
}

export function mapSessionRow(row: {
  id: string;
  roomCode: string;
  sellerId: string;
  status: "live" | "ended";
  featuredProductId: string | null;
  facebookObjectId: string | null;
  facebookPageId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}): LiveSession {
  return {
    id: row.id,
    roomCode: row.roomCode,
    sellerId: row.sellerId,
    status: row.status,
    featuredProductId: row.featuredProductId,
    facebookObjectId: row.facebookObjectId,
    facebookPageId: row.facebookPageId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

export function mapOrderRow(row: {
  id: string;
  code: string;
  sessionId: string;
  total: number;
  status: Order["status"];
  publicToken: string;
  sourceCommentIds: string[];
  sellerEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
  buyer: {
    id: string;
    source: Order["buyer"]["source"];
    externalId: string;
    displayName: string;
  };
  items: Array<{
    productId: string;
    productCode: string;
    productName: string;
    size: string | null;
    qty: number;
    unitPrice: number;
  }>;
}): Order {
  return {
    id: row.id,
    code: row.code,
    sessionId: row.sessionId,
    buyer: {
      id: row.buyer.id,
      source: row.buyer.source,
      externalId: row.buyer.externalId,
      displayName: row.buyer.displayName,
    },
    items: row.items.map((item) => ({
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      size: item.size,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    total: row.total,
    status: row.status,
    publicToken: row.publicToken,
    sourceCommentIds: [...row.sourceCommentIds],
    sellerEdited: row.sellerEdited,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function makeOrderItem(product: Product, size: string | null, qty: number): OrderItem {
  const validSize = product.sizes.length === 0 ? size === null : size !== null && product.sizes.includes(size);
  if (!validSize) throw new Error(`Invalid size for ${product.code}: ${size}`);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Invalid quantity: ${qty}`);
  return {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    size,
    qty,
    unitPrice: product.price,
  };
}

function requireStock(product: Product, size: string | null, qty: number): void {
  if (stockAt(product.stock, size) < qty) {
    throw new Error(`Insufficient stock for ${product.code} (${size ?? "no size"})`);
  }
}

function adjustStock(stock: Record<string, number>, size: string | null, delta: number): Record<string, number> {
  return { ...stock, [size ?? ""]: stockAt(stock, size) + delta };
}

export class PrismaOrderGateway implements OrderGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async getSessionContext(sessionId: string): Promise<SessionContext> {
    const sessionRow = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: { products: { orderBy: [{ createdAt: "asc" }, { code: "asc" }] } },
    });
    if (!sessionRow) throw new Error(`Unknown session: ${sessionId}`);
    return {
      session: mapSessionRow(sessionRow),
      catalog: sessionRow.products.map(mapProductRow),
      previouslyFeatured: [...sessionRow.previouslyFeatured],
    };
  }

  async getOpenOrders(sessionId: string, buyerExternalIds: string[]): Promise<Map<string, Order>> {
    const sessionRow = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!sessionRow) throw new Error(`Unknown session: ${sessionId}`);

    const open = new Map<string, Order>();
    if (buyerExternalIds.length === 0) return open;

    const rows = await this.prisma.order.findMany({
      where: {
        sessionId,
        status: { in: ["pending_payment", "awaiting_confirmation"] },
        buyer: { externalId: { in: buyerExternalIds } },
      },
      include: {
        buyer: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    for (const row of rows) {
      open.set(row.buyer.externalId, mapOrderRow(row));
    }
    return open;
  }

  async addItem(
    sessionId: string,
    buyer: BuyerRef,
    line: LineRef & { qty: number },
    commentId: string,
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "LiveSession" WHERE id = ${sessionId} FOR UPDATE
      `;
      if (sessionRows.length === 0) throw new Error(`Unknown session: ${sessionId}`);

      const buyerRow = await tx.buyer.upsert({
        where: { sessionId_externalId: { sessionId, externalId: buyer.externalId } },
        create: { sessionId, externalId: buyer.externalId, displayName: buyer.name, source: buyer.source },
        update: { displayName: buyer.name },
      });
      await tx.$queryRaw`SELECT id FROM "Buyer" WHERE id = ${buyerRow.id} FOR UPDATE`;

      // Lock existing open Order (if any) before locking Product to keep lock order consistent across all order ops.
      const existingOrderRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Order"
        WHERE "sessionId" = ${sessionId}
          AND "buyerId" = ${buyerRow.id}
          AND status IN ('pending_payment', 'awaiting_confirmation')
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE
      `;
      const existingOrder = existingOrderRows[0]
        ? await tx.order.findUnique({
            where: { id: existingOrderRows[0].id },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          })
        : null;

      const product = await this.lockProduct(tx, sessionId, line.productId);
      const item = makeOrderItem(product, line.size, line.qty);
      requireStock(product, item.size, item.qty);

      const nextStock = adjustStock(product.stock, item.size, -item.qty);
      await tx.product.update({
        where: { id: product.id },
        data: { stock: nextStock as Prisma.InputJsonValue },
      });

      if (!existingOrder) {
        const seqRows = await tx.$queryRaw<Array<{ nextOrderSeq: number }>>`
          UPDATE "LiveSession"
          SET "nextOrderSeq" = "nextOrderSeq" + 1
          WHERE id = ${sessionId}
          RETURNING "nextOrderSeq"
        `;
        const seq = seqRows[0]?.nextOrderSeq;
        if (!seq) throw new Error(`Unknown session: ${sessionId}`);

        const total = item.qty * item.unitPrice;
        const created = await tx.order.create({
          data: {
            code: `A${seq}`,
            sessionId,
            buyerId: buyerRow.id,
            status: "pending_payment",
            total,
            publicToken: randomUUID(),
            sourceCommentIds: [commentId],
            sellerEdited: false,
            items: {
              create: [{
                productId: item.productId,
                productCode: item.productCode,
                productName: item.productName,
                size: item.size,
                qty: item.qty,
                unitPrice: item.unitPrice,
                sortOrder: 0,
              }],
            },
          },
          include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
        });
        return mapOrderRow(created);
      }

      const matching = existingOrder.items.find((existing) => sameLine(existing, item));
      if (matching) {
        await tx.orderItem.update({
          where: { id: matching.id },
          data: { qty: matching.qty + item.qty },
        });
      } else {
        const maxSort = existingOrder.items.reduce((max, i) => Math.max(max, i.sortOrder), -1);
        await tx.orderItem.create({
          data: {
            orderId: existingOrder.id,
            productId: item.productId,
            productCode: item.productCode,
            productName: item.productName,
            size: item.size,
            qty: item.qty,
            unitPrice: item.unitPrice,
            sortOrder: maxSort + 1,
          },
        });
      }

      const updatedItems = await tx.orderItem.findMany({
        where: { orderId: existingOrder.id },
        orderBy: { sortOrder: "asc" },
      });
      const total = updatedItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
      const updated = await tx.order.update({
        where: { id: existingOrder.id },
        data: {
          total,
          sourceCommentIds: [...existingOrder.sourceCommentIds, commentId],
          updatedAt: new Date(Math.max(Date.now(), existingOrder.updatedAt.getTime() + 1)),
        },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      return mapOrderRow(updated);
    });
  }

  async updateItem(
    orderId: string,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
    commentId: string,
  ): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const meta = await tx.order.findUnique({ where: { id: orderId }, select: { sessionId: true } });
      if (!meta) throw new Error(`No open order: ${orderId}`);
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${meta.sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!order || !isOpenStatus(order.status)) throw new Error(`No open order: ${orderId}`);

      const old = order.items.find((item) => sameLine(item, line));
      if (!old) throw new Error(`Missing order line: ${line.productId} (${line.size ?? "no size"})`);

      const targetProductId = patch.productId ?? old.productId;
      const lockedProducts = await this.lockProducts(tx, order.sessionId, [old.productId, targetProductId]);
      const oldProduct = lockedProducts.get(old.productId);
      const targetProduct = lockedProducts.get(targetProductId);
      if (!oldProduct || !targetProduct) throw new Error(`Unknown product id: ${targetProductId}`);

      const nextSize = patch.size === undefined ? old.size : patch.size;
      const nextItem = makeOrderItem(targetProduct, nextSize, patch.qty ?? old.qty);
      const released = sameLine(old, nextItem) ? old.qty : 0;
      requireStock(targetProduct, nextItem.size, nextItem.qty - released);

      if (oldProduct.id === targetProduct.id) {
        let stock = adjustStock(oldProduct.stock, old.size, old.qty);
        stock = adjustStock(stock, nextItem.size, -nextItem.qty);
        await tx.product.update({
          where: { id: oldProduct.id },
          data: { stock: stock as Prisma.InputJsonValue },
        });
      } else {
        const oldStock = adjustStock(oldProduct.stock, old.size, old.qty);
        const targetStock = adjustStock(targetProduct.stock, nextItem.size, -nextItem.qty);
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
          sourceCommentIds: [...order.sourceCommentIds, commentId],
          updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)),
        },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      return mapOrderRow(updated);
    });
  }

  async removeItem(orderId: string, line: LineRef | null, commentId: string): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const meta = await tx.order.findUnique({ where: { id: orderId }, select: { sessionId: true } });
      if (!meta) throw new Error(`No open order: ${orderId}`);
      await tx.$queryRaw`SELECT id FROM "LiveSession" WHERE id = ${meta.sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      if (!order || !isOpenStatus(order.status)) throw new Error(`No open order: ${orderId}`);

      const removed =
        line === null
          ? order.items
          : (() => {
              const found = order.items.find((item) => sameLine(item, line));
              if (!found) throw new Error(`Missing order line: ${line.productId} (${line.size ?? "no size"})`);
              return [found];
            })();

      const lockedProducts = await this.lockProducts(
        tx,
        order.sessionId,
        removed.map((item) => item.productId),
      );
      const nextStocks = new Map<string, Record<string, number>>();
      for (const item of removed) {
        const product = lockedProducts.get(item.productId);
        if (!product) continue;
        const current = nextStocks.get(product.id) ?? product.stock;
        nextStocks.set(product.id, adjustStock(current, item.size, item.qty));
      }
      for (const [productId, stock] of nextStocks) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: stock as Prisma.InputJsonValue },
        });
      }

      if (line !== null) {
        const target = removed[0]!;
        await tx.orderItem.delete({ where: { id: target.id } });
      }

      const remainingItems =
        line === null
          ? order.items
          : order.items.filter((item) => item.id !== removed[0]!.id);
      const isCancelled = line === null || remainingItems.length === 0;
      const total = remainingItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);

      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: isCancelled ? "cancelled" : order.status,
          total,
          sourceCommentIds: [...order.sourceCommentIds, commentId],
          updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)),
        },
        include: { buyer: true, items: { orderBy: { sortOrder: "asc" } } },
      });
      return mapOrderRow(updated);
    });
  }

  private async lockProduct(tx: Prisma.TransactionClient, sessionId: string, productId: string): Promise<Product> {
    const rows = await tx.$queryRaw<RawProductRow[]>`
      SELECT id, code, name, sizes, price, stock
      FROM "Product"
      WHERE id = ${productId} AND "sessionId" = ${sessionId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error(`Unknown product id: ${productId}`);
    return mapProductRow(row);
  }

  private async lockProducts(
    tx: Prisma.TransactionClient,
    sessionId: string,
    productIds: string[],
  ): Promise<Map<string, Product>> {
    const uniqueSorted = [...new Set(productIds)].sort();
    const locked = new Map<string, Product>();
    for (const id of uniqueSorted) {
      const rows = await tx.$queryRaw<RawProductRow[]>`
        SELECT id, code, name, sizes, price, stock
        FROM "Product"
        WHERE id = ${id} AND "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (row) locked.set(id, mapProductRow(row));
    }
    return locked;
  }
}
