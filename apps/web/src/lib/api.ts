import type {
  FacebookLiveVideo,
  FacebookPageSummary,
  FacebookStatusResponse,
  JoinRoomResponse,
  LiveSession,
  Order,
  OrderLinePatch,
  Product,
  ProductInput,
  PublicRoomResponse,
  Seller,
  SessionDetail,
  SessionSummary,
} from "./types";

export class ApiError extends Error {
  status: number;
  reconnect?: boolean;

  constructor(message: string, status: number, reconnect?: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reconnect = reconnect;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    ...(method === "GET" ? { cache: "no-store" as const } : {}),
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string; reconnect?: boolean } | null;
    throw new ApiError(
      errObj?.error ?? `Yêu cầu thất bại (${res.status})`,
      res.status,
      errObj?.reconnect,
    );
  }

  return data as T;
}

export const api = {
  auth: {
    me: () => requestJson<{ seller: Seller }>("/api/auth/me"),
    login: (body: { email: string; password: string }) =>
      requestJson<{ seller: Seller }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    register: (body: { email: string; password: string; displayName?: string }) =>
      requestJson<{ seller: Seller }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    logout: () =>
      requestJson<{ ok?: boolean }>("/api/auth/logout", {
        method: "POST",
      }),
    socketToken: () => requestJson<{ token: string }>("/api/auth/socket-token"),
  },

  sessions: {
    list: () => requestJson<{ sessions: LiveSession[] }>("/api/sessions"),
    create: () =>
      requestJson<{ session: LiveSession }>("/api/sessions", {
        method: "POST",
      }),
    get: (id: string) => requestJson<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
    end: (id: string) =>
      requestJson<{ session: LiveSession }>(`/api/sessions/${encodeURIComponent(id)}/end`, {
        method: "POST",
      }),
    summary: (id: string) =>
      requestJson<SessionSummary>(`/api/sessions/${encodeURIComponent(id)}/summary`),
    setFeatured: (id: string, productId: string | null) =>
      requestJson<{ session: LiveSession }>(`/api/sessions/${encodeURIComponent(id)}/featured`, {
        method: "PUT",
        body: JSON.stringify({ productId }),
      }),
  },

  products: {
    create: (sessionId: string, body: ProductInput) =>
      requestJson<{ product: Product }>(`/api/sessions/${encodeURIComponent(sessionId)}/products`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (sessionId: string, productId: string, body: Partial<ProductInput>) =>
      requestJson<{ product: Product }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/products/${encodeURIComponent(productId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      ),
    remove: (sessionId: string, productId: string) =>
      requestJson<{ ok?: boolean }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/products/${encodeURIComponent(productId)}`,
        {
          method: "DELETE",
        },
      ),
  },

  orders: {
    patchLine: (sessionId: string, orderId: string, body: OrderLinePatch) =>
      requestJson<{ order: Order }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/orders/${encodeURIComponent(orderId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      ),
    approve: (orderId: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/approve`, {
        method: "POST",
      }),
    cancel: (orderId: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
      }),
    confirm: (orderId: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/confirm`, {
        method: "POST",
      }),
    deliver: (orderId: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(orderId)}/deliver`, {
        method: "POST",
      }),
    remind: (orderId: string) =>
      requestJson<{ message: string }>(`/api/orders/${encodeURIComponent(orderId)}/remind`, {
        method: "POST",
      }),
    getPublic: (token: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(token)}`),
    reportPayment: (token: string) =>
      requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(token)}/report-payment`, {
        method: "POST",
      }),
  },

  rooms: {
    get: (roomCode: string) =>
      requestJson<PublicRoomResponse>(`/api/rooms/${encodeURIComponent(roomCode)}`),
    join: (roomCode: string, body: { displayName: string; buyerToken?: string }) =>
      requestJson<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  facebook: {
    status: () => requestJson<FacebookStatusResponse>("/api/facebook/status"),
    selectPage: (pageId: string) =>
      requestJson<{ selectedPage: FacebookPageSummary }>("/api/facebook/pages/select", {
        method: "POST",
        body: JSON.stringify({ pageId }),
      }),
    liveVideos: () => requestJson<{ videos: FacebookLiveVideo[] }>("/api/facebook/live-videos"),
    watch: (body: { objectId: string; sessionId?: string }) =>
      requestJson<{ watching: string }>("/api/facebook/watch", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    disconnect: () =>
      requestJson<{ connected: boolean }>("/api/facebook/disconnect", {
        method: "POST",
      }),
  },
};
