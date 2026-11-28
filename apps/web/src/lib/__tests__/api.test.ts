import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses cache: no-store for GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ seller: { id: "s1", email: "a@b.c", displayName: "Shop" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await api.auth.me();
    expect(res.seller.email).toBe("a@b.c");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
      }),
    );
  });

  it("parses { error: string } into ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Chưa đăng nhập", reconnect: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.facebook.status()).rejects.toMatchObject({
      name: "ApiError",
      message: "Chưa đăng nhập",
      status: 401,
      reconnect: true,
    } satisfies Partial<ApiError>);
  });

  it("sends watch body with objectId and optional sessionId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ watching: "12345" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await api.facebook.watch({ objectId: "12345", sessionId: "s_1" });
    expect(res.watching).toBe("12345");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/facebook/watch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ objectId: "12345", sessionId: "s_1" }),
      }),
    );
  });
});
