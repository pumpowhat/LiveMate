import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@livemate/shared";
import { GraphApiError, GraphClient } from "./graph.ts";
import { CommentPoller, fbReplyFor } from "./poller.ts";

function page(ids: number[], nextCursor?: string): Response {
  return Response.json({
    data: ids.map((id) => ({
      id: String(id),
      message: `Bình luận ${id}`,
      created_time: `2026-11-27T02:00:0${id}+0000`,
      from: id === 4 ? undefined : { id: "buyer", name: "An" },
    })),
    paging: nextCursor && { next: "https://graph.facebook.com/next", cursors: { after: nextCursor } },
  });
}

describe("CommentPoller", () => {
  const pollers: CommentPoller[] = [];

  function createPoller(fetchImpl: typeof fetch, options: Partial<ConstructorParameters<typeof CommentPoller>[0]> = {}) {
    const received: Comment[] = [];
    const poller = new CommentPoller({
      client: new GraphClient({ graphVersion: "v99.0", fetchImpl }),
      objectId: "post",
      pageToken: "page-token",
      sessionId: "session",
      onComment: (comment) => { received.push(comment); },
      ...options,
    });
    pollers.push(poller);
    poller.start();
    return { poller, received };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const poller of pollers.splice(0)) poller.stop();
    vi.useRealTimers();
  });

  it("marks the backlog and emits only new comments oldest-first across overlapping pages", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([2], "backlog"))
      .mockResolvedValueOnce(page([2, 1]))
      .mockResolvedValueOnce(page([5, 4], "new"))
      .mockResolvedValueOnce(page([4, 3, 2], "unused"))
      .mockResolvedValueOnce(page([5, 4]));
    const { received } = createPoller(fetchImpl);
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(received.map(({ id }) => id)).toEqual(["fb_3", "fb_4", "fb_5"]);
    expect(received[1]).toEqual({
      id: "fb_4",
      source: "facebook",
      externalId: "4",
      buyerExternalId: "fb_anon_4",
      buyerName: "Khách Facebook",
      text: "Bình luận 4",
      createdAt: "2026-11-27T02:00:04.000Z",
      sessionId: "session",
    });
    const comment = received[0]!;
    expect(fbReplyFor(comment)).toBe("3");
    expect(fbReplyFor({ ...comment, source: "room" })).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(received).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("can emit the backlog on startup", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(page([2, 1]));
    const { received } = createPoller(fetchImpl, { emitBacklog: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(received.map(({ externalId }) => externalId)).toEqual(["1", "2"]);
  });

  it("skips scheduled ticks while a request is pending and discards results after stopping", async () => {
    let respond!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { respond = resolve; });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(page([2]));
    const { poller, received } = createPoller(fetchImpl, { emitBacklog: true });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    respond(page([1]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(received.map(({ externalId }) => externalId)).toEqual(["1", "2"]);

    const next = new Promise<Response>((resolve) => { respond = resolve; });
    fetchImpl.mockReturnValueOnce(next);
    await vi.advanceTimersByTimeAsync(2_000);
    poller.stop();
    respond(page([3, 2]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(received).toHaveLength(2);
  });

  it("stops polling and passes the original Graph error to onError when the token expires", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: { message: "Expired", code: 190, error_subcode: 463 },
    }, { status: 400 }));
    const onError = vi.fn();
    createPoller(fetchImpl, { onError });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(GraphApiError));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 190, subcode: 463 });
  });

  it("backs off exponentially up to 30 seconds and resumes the normal interval after success", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]));
    createPoller(fetchImpl, { intervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
