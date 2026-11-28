import type { FbPage } from "./oauth.ts";

export interface FacebookConnection {
  userToken: string;
  pages: FbPage[];
  selectedPageId: string | null;
  connectedAt: number;
}

export interface FacebookConnectionStore {
  save(sellerId: string, userToken: string, pages: FbPage[]): void | Promise<void>;
  get(sellerId: string): FacebookConnection | null | Promise<FacebookConnection | null>;
  selectPage(sellerId: string, pageId: string): FbPage | null | Promise<FbPage | null>;
  selectedPage(sellerId: string): FbPage | null | Promise<FbPage | null>;
  disconnect(sellerId: string): void | Promise<void>;
}

export class InMemoryFacebookConnectionStore implements FacebookConnectionStore {
  private readonly connections = new Map<string, FacebookConnection>();

  save(sellerId: string, userToken: string, pages: FbPage[]): void {
    this.connections.set(sellerId, { userToken, pages, selectedPageId: null, connectedAt: Date.now() });
  }

  get(sellerId: string): FacebookConnection | null {
    return this.connections.get(sellerId) ?? null;
  }

  selectPage(sellerId: string, pageId: string): FbPage | null {
    const connection = this.get(sellerId);
    if (!connection) return null;

    const page = connection.pages.find(({ id }) => id === pageId);
    if (!page) return null;

    connection.selectedPageId = page.id;
    return page;
  }

  selectedPage(sellerId: string): FbPage | null {
    const connection = this.get(sellerId);
    return connection?.pages.find(({ id }) => id === connection.selectedPageId) ?? null;
  }

  disconnect(sellerId: string): void {
    this.connections.delete(sellerId);
  }
}
