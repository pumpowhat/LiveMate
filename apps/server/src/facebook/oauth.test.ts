import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLoginUrl, createFacebookOAuth, createStateStore } from "./oauth.ts";

const config = {
  appId: "app",
  appSecret: "secret",
  redirectUri: "https://livemate.example/facebook/callback?source=app",
  graphVersion: "v99.0",
};

describe("Facebook Login", () => {
  afterEach(() => vi.useRealTimers());

  it("builds a versioned login URL with the requested Page permissions", () => {
    const url = new URL(buildLoginUrl({ ...config, state: "nonce+/=" }));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v99.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app",
      redirect_uri: config.redirectUri,
      state: "nonce+/=",
      response_type: "code",
      scope: "pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_engagement",
    });
  });

  it("exchanges code and short-lived tokens and lists Pages using the long-lived token", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "short-lived" }))
      .mockResolvedValueOnce(Response.json({ access_token: "long-lived" }))
      .mockResolvedValueOnce(Response.json({
        data: [{ id: "page-1", name: "Shop", access_token: "page-token-1", tasks: ["MODERATE"] }],
        paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor" } },
      }))
      .mockResolvedValueOnce(Response.json({
        data: [{ id: "page-2", name: "Shop 2", access_token: "page-token-2", tasks: ["MANAGE"] }],
      }));
    const oauth = createFacebookOAuth({ ...config, fetchImpl });

    const shortLived = await oauth.exchangeCode("oauth-code");
    expect(shortLived).toBe("short-lived");
    const longLived = await oauth.toLongLived(shortLived);
    expect(longLived).toBe("long-lived");
    await expect(oauth.listPages(longLived)).resolves.toEqual([
      { id: "page-1", name: "Shop", accessToken: "page-token-1", tasks: ["MODERATE"] },
      { id: "page-2", name: "Shop 2", accessToken: "page-token-2", tasks: ["MANAGE"] },
    ]);

    const [codeUrl, tokenUrl, pagesUrl, nextUrl] = fetchImpl.mock.calls.map(([url]) => new URL(String(url)));
    expect(codeUrl?.pathname).toBe("/v99.0/oauth/access_token");
    expect(Object.fromEntries(codeUrl!.searchParams)).toEqual({
      client_id: "app", client_secret: "secret", redirect_uri: config.redirectUri, code: "oauth-code",
    });
    expect(tokenUrl?.pathname).toBe("/v99.0/oauth/access_token");
    expect(Object.fromEntries(tokenUrl!.searchParams)).toEqual({
      client_id: "app", client_secret: "secret", grant_type: "fb_exchange_token", fb_exchange_token: "short-lived",
    });
    expect(pagesUrl?.pathname).toBe("/v99.0/me/accounts");
    expect(Object.fromEntries(pagesUrl!.searchParams)).toEqual({
      fields: "id,name,access_token,tasks", access_token: "long-lived",
    });
    expect(nextUrl?.searchParams.get("after")).toBe("cursor");
  });

  it("issues distinct single-use states tied to a seller and expires them after ten minutes", () => {
    vi.useFakeTimers();
    const store = createStateStore();
    const valid = store.issue("seller-1");
    const expiring = store.issue("seller-1");
    expect(valid).not.toBe(expiring);
    expect(store.consume("unknown")).toBeNull();

    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(store.consume(valid)).toBe("seller-1");
    expect(store.consume(valid)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.consume(expiring)).toBeNull();
  });
});
