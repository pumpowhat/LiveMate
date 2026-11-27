import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphClient } from "./graph.ts";

describe("GraphClient", () => {
  it("requests newest comments with the expected fields and maps missing authors to null", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      data: [
        { id: "2", message: "Hai", created_time: "2026-11-27T02:00:01+0000" },
        {
          id: "1", message: "Một", created_time: "2026-11-27T02:00:00+0000",
          from: { id: "buyer", name: "An" },
        },
      ],
      paging: { cursors: { after: "a+/=" }, next: "https://graph.facebook.com/next" },
    }));
    const client = new GraphClient({ graphVersion: "v99.0", fetchImpl });

    await expect(client.listComments("post", "page-token")).resolves.toEqual({
      comments: [
        { id: "2", message: "Hai", createdTime: "2026-11-27T02:00:01+0000", fromId: null, fromName: null },
        { id: "1", message: "Một", createdTime: "2026-11-27T02:00:00+0000", fromId: "buyer", fromName: "An" },
      ],
      nextCursor: "a+/=",
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v99.0/post/comments");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: "id,message,created_time,from{id,name}",
      order: "reverse_chronological",
      filter: "stream",
      limit: "50",
      access_token: "page-token",
    });
  });

  it("encodes a supplied cursor and limit and stops when Graph omits the next link", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      data: [],
      paging: { cursors: { after: "last" } },
    }));
    const client = new GraphClient({ graphVersion: "v99.0", fetchImpl });

    await expect(client.listComments("post", "token", { after: "a+/=", limit: 25 }))
      .resolves.toEqual({ comments: [] });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("after")).toBe("a+/=");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("parses Graph error details and identifies token expiry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: {
        message: "Session expired", type: "OAuthException",
        code: 190, error_subcode: 463, fbtrace_id: "trace-id",
      },
    }, { status: 400 }));
    const client = new GraphClient({ graphVersion: "v99.0", fetchImpl });
    const result = client.getJson("/me", {}, "expired-token");

    await expect(result).rejects.toBeInstanceOf(GraphApiError);
    await expect(result).rejects.toMatchObject({
      message: "Session expired", code: 190, subcode: 463, type: "OAuthException",
      fbtraceId: "trace-id", isTokenError: true,
    });
  });

  it("posts a URL-encoded reply and returns the new comment ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "reply" }));
    const client = new GraphClient({ graphVersion: "v99.0", fetchImpl });

    await expect(client.replyToComment("post_1", "Cảm ơn & hẹn gặp lại!", "page-token"))
      .resolves.toBe("reply");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://graph.facebook.com/v99.0/post_1/comments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      message: "Cảm ơn & hẹn gặp lại!",
      access_token: "page-token",
    });
  });

  it("lists a page's live videos with status and underlying video ID", async () => {
    const video = { id: "live", status: "LIVE", video: { id: "video" } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [video] }));
    const client = new GraphClient({ graphVersion: "v99.0", fetchImpl });

    await expect(client.getPageLiveVideos("page", "token")).resolves.toEqual([video]);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v99.0/page/live_videos");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: "id,status,title,video{id},creation_time", limit: "10", access_token: "token",
    });
  });
});
