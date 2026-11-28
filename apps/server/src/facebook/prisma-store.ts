import type { Prisma, PrismaClient } from "@prisma/client";
import type { FbPage } from "./oauth.ts";
import type { FacebookConnection, FacebookConnectionStore } from "./store.ts";

function parsePages(raw: unknown): FbPage[] {
  if (!Array.isArray(raw)) return [];
  const out: FbPage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id === "string" && typeof rec.name === "string" && typeof rec.accessToken === "string") {
      out.push({
        id: rec.id,
        name: rec.name,
        accessToken: rec.accessToken,
        tasks: Array.isArray(rec.tasks) ? rec.tasks.filter((t): t is string => typeof t === "string") : [],
      });
    }
  }
  return out;
}

export class PrismaFacebookConnectionStore implements FacebookConnectionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(sellerId: string, userToken: string, pages: FbPage[]): Promise<void> {
    await this.prisma.facebookConnection.upsert({
      where: { sellerId },
      create: {
        sellerId,
        userToken,
        pages: pages as unknown as Prisma.InputJsonValue,
        selectedPageId: null,
        connectedAt: new Date(),
      },
      update: {
        userToken,
        pages: pages as unknown as Prisma.InputJsonValue,
        selectedPageId: null,
        connectedAt: new Date(),
      },
    });
  }

  async get(sellerId: string): Promise<FacebookConnection | null> {
    const row = await this.prisma.facebookConnection.findUnique({ where: { sellerId } });
    if (!row) return null;
    return {
      userToken: row.userToken,
      pages: parsePages(row.pages),
      selectedPageId: row.selectedPageId,
      connectedAt: row.connectedAt.getTime(),
    };
  }

  async selectPage(sellerId: string, pageId: string): Promise<FbPage | null> {
    const connection = await this.get(sellerId);
    if (!connection) return null;

    const page = connection.pages.find(({ id }) => id === pageId);
    if (!page) return null;

    await this.prisma.facebookConnection.update({
      where: { sellerId },
      data: { selectedPageId: page.id },
    });
    return page;
  }

  async selectedPage(sellerId: string): Promise<FbPage | null> {
    const connection = await this.get(sellerId);
    return connection?.pages.find(({ id }) => id === connection.selectedPageId) ?? null;
  }

  async disconnect(sellerId: string): Promise<void> {
    await this.prisma.facebookConnection.deleteMany({ where: { sellerId } });
  }
}
