import type { Comment, LiveSession, Product } from "@livemate/shared";
import { expect, test, vi } from "vitest";
import type { LlmClient } from "./llm.ts";
import { InMemoryOrderGateway } from "./memory-gateway.ts";
import { CommentPipeline, type PipelineSink } from "./pipeline.ts";

const session: LiveSession = {
  id: "live",
  roomCode: "room",
  status: "live",
  featuredProductId: "p_v03",
  facebookObjectId: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
};
const catalog: Product[] = [
  { id: "p_v03", code: "V03", name: "Váy hoa nhí", sizes: ["M", "L"], price: 250_000, stock: { M: 2, L: 2 } },
];

class FakeLlm implements LlmClient {
  readonly name = "fake";
  attempts = 0;

  constructor(private readonly response: string | Error, private readonly retryResponse = response) {}

  async completeJson(): Promise<string> {
    const response = ++this.attempts === 1 ? this.response : this.retryResponse;
    if (response instanceof Error) throw response;
    return response;
  }
}

function setup(llm: LlmClient, maxBatchSize = 20) {
  const gateway = new InMemoryOrderGateway({ session, catalog });
  const sink = {
    onVerdict: vi.fn<PipelineSink["onVerdict"]>(),
    onOrder: vi.fn<PipelineSink["onOrder"]>(),
    onReply: vi.fn<PipelineSink["onReply"]>(),
    onNeedsReview: vi.fn<PipelineSink["onNeedsReview"]>(),
    onError: vi.fn<PipelineSink["onError"]>(),
  };
  return { gateway, sink, pipeline: new CommentPipeline(llm, gateway, sink, { batchWindowMs: 10, maxBatchSize }) };
}

function comment(id: string, text: string): Comment {
  return { id, text, sessionId: session.id, source: "room", buyerExternalId: "buyer", buyerName: "Lan", createdAt: session.startedAt };
}

test("ignores a noise comment without calling the LLM", async () => {
  const llm = new FakeLlm('{"actions":[]}');
  const { pipeline, sink } = setup(llm);

  await pipeline.push(comment("c1", "đẹp quá shop ơi"));
  await pipeline.drain(session.id);

  expect(sink.onVerdict.mock.calls).toEqual([[session.id, "c1", "ignored"]]);
  expect(llm.attempts).toBe(0);
});

test("drains every accepted comment in arrival order, including those still entering their batches", async () => {
  const llm = new FakeLlm('{"actions":[]}');
  const { pipeline, sink } = setup(llm, 1);
  const pushes = ["c1", "c2", "c3"].map((id) => pipeline.push(comment(id, "chốt V03 size M")));

  await pipeline.drain(session.id);
  expect(llm.attempts).toBe(3);
  expect(sink.onVerdict.mock.calls.filter(([, , verdict]) => verdict === "ignored").map(([, id]) => id))
    .toEqual(["c1", "c2", "c3"]);
  await Promise.all(pushes);
});

test("creates and then updates the same order within one timed batch", async () => {
  vi.useFakeTimers();
  try {
    const llm = new FakeLlm(JSON.stringify({ actions: [
      { action: "create", commentId: "c1", buyer: "buyer", item: "V03", size: "M", qty: 1 },
      { action: "update", commentId: "c2", buyer: "buyer", item: "V03", size: "L", qty: null, newItem: null },
    ] }));
    const { gateway, pipeline, sink } = setup(llm);

    await pipeline.push(comment("c1", "chốt V03 size M"));
    await pipeline.push(comment("c2", "đổi V03 sang size L"));
    expect(llm.attempts).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(llm.attempts).toBe(1);
    await pipeline.drain(session.id);

    const orders = gateway.listOrders();
    expect(orders).toMatchObject([
      { items: [{ productCode: "V03", size: "L", qty: 1 }], sourceCommentIds: ["c1", "c2"] },
    ]);
    const order = orders[0]!;
    expect(gateway.getProduct("V03")?.stock).toEqual({ M: 2, L: 1 });
    expect(sink.onOrder.mock.calls.map(([sessionId, snapshot, created]) => [sessionId, snapshot, created])).toEqual([
      [session.id, expect.objectContaining({ id: order.id, items: [expect.objectContaining({ size: "M" })] }), true],
      [session.id, order, false],
    ]);
    expect(sink.onVerdict.mock.calls).toEqual([
      [session.id, "c1", "queued"],
      [session.id, "c2", "queued"],
      [session.id, "c1", "create", order.id],
      [session.id, "c2", "update", order.id],
    ]);
    expect(sink.onError).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("retries invalid LLM JSON and processes the valid response on attempt two", async () => {
  const llm = new FakeLlm("invalid JSON", JSON.stringify({ actions: [
    { action: "create", commentId: "c1", buyer: "buyer", item: "V03", size: "M", qty: 1 },
  ] }));
  const { gateway, pipeline, sink } = setup(llm);

  await pipeline.push(comment("c1", "chốt V03 size M"));
  await pipeline.drain(session.id);

  expect(llm.attempts).toBe(2);
  expect(gateway.listOrders()).toMatchObject([{ items: [{ productCode: "V03", size: "M", qty: 1 }] }]);
  expect(sink.onError).not.toHaveBeenCalled();
});

test("reports an LLM error and marks the entire batch unparsed", async () => {
  const llm = new FakeLlm(new Error("LLM unavailable"));
  const { gateway, pipeline, sink } = setup(llm);
  const first = comment("c1", "chốt V03 size M");
  const second = comment("c2", "lấy V03 size L");

  await pipeline.push(first);
  await pipeline.push(second);
  await pipeline.drain(session.id);

  expect(sink.onError.mock.calls).toEqual([[session.id, expect.any(Error), [first, second]]]);
  expect(sink.onVerdict.mock.calls).toEqual([
    [session.id, "c1", "queued"],
    [session.id, "c2", "queued"],
    [session.id, "c1", "unparsed"],
    [session.id, "c2", "unparsed"],
  ]);
  expect(gateway.listOrders()).toEqual([]);
});

test("marks a comment ignored when the LLM returns no action for it", async () => {
  const { pipeline, sink } = setup(new FakeLlm('{"actions":[]}'));

  await pipeline.push(comment("c1", "chốt V03 size M"));
  await pipeline.drain(session.id);

  expect(sink.onVerdict.mock.calls).toEqual([[session.id, "c1", "queued"], [session.id, "c1", "ignored"]]);
  expect(sink.onError).not.toHaveBeenCalled();
});

test("forwards an ask action's reply text to the sink", async () => {
  const reply = "Dạ V03 còn size L ạ.";
  const llm = new FakeLlm(JSON.stringify({ actions: [{ action: "ask", commentId: "c1", buyer: "buyer", reply }] }));
  const { pipeline, sink } = setup(llm);
  const question = comment("c1", "V03 còn size L không shop?");

  await pipeline.push(question);
  await pipeline.drain(session.id);

  expect(sink.onReply.mock.calls).toEqual([[session.id, question, reply, "ask", undefined]]);
  expect(sink.onVerdict).toHaveBeenLastCalledWith(session.id, "c1", "ask");
  expect(sink.onOrder).not.toHaveBeenCalled();
});

/** LLM giả chạy `during` trong lúc "suy nghĩ": giả lập trạng thái đơn đổi khi đang chờ LLM. */
class RacingLlm implements LlmClient {
  readonly name = "racing";
  constructor(private readonly response: string, private readonly during: () => void) {}
  async completeJson(): Promise<string> {
    this.during();
    return this.response;
  }
}

test("sends a change to review when the order is locked while the LLM is running", async () => {
  const cases = [
    { lock: { sellerEdited: true }, reason: "seller_edited", action: { action: "update", commentId: "c1", buyer: "buyer", item: "V03", size: "L", qty: null, newItem: null } },
    { lock: { status: "awaiting_confirmation" as const }, reason: "payment_reported", action: { action: "create", commentId: "c1", buyer: "buyer", item: "V03", size: "L", qty: 1 } },
  ];
  for (const { lock, reason, action } of cases) {
    let orderId = "";
    const llm = new RacingLlm(JSON.stringify({ actions: [action] }), () => gateway.patchOrder(orderId, lock));
    const { gateway, pipeline, sink } = setup(llm);
    orderId = gateway.seedOrder({ externalId: "buyer", name: "Lan", source: "room" }, [{ item: "V03", size: "M", qty: 1 }]).id;

    await pipeline.push(comment("c1", "đổi sang L nha shop"));
    await pipeline.drain(session.id);

    expect(sink.onNeedsReview.mock.calls).toEqual([
      [session.id, expect.objectContaining({ id: "c1" }), expect.objectContaining({ kind: "needs_review", orderId, reason })],
    ]);
    expect(sink.onVerdict.mock.calls.at(-1)).toEqual([session.id, "c1", "unparsed", orderId]);
    expect(sink.onOrder).not.toHaveBeenCalled();
    expect(sink.onError).not.toHaveBeenCalled();
    expect(gateway.listOrders()[0]?.items).toMatchObject([{ size: "M", qty: 1 }]);
  }
});

test("a failing operation only marks its own comment unparsed and the batch continues", async () => {
  let seededId = "";
  // Shop bấm hủy đơn trong lúc LLM đang chạy, nên thao tác sửa lỗi "No open order".
  const llm = new RacingLlm(JSON.stringify({ actions: [
    { action: "update", commentId: "c1", buyer: "buyer", item: "V03", size: "L", qty: null, newItem: null },
    { action: "create", commentId: "c2", buyer: "b2", item: "V03", size: "M", qty: 1 },
  ] }), () => gateway.patchOrder(seededId, { status: "cancelled" }));
  const { gateway, pipeline, sink } = setup(llm);
  seededId = gateway.seedOrder({ externalId: "buyer", name: "Lan", source: "room" }, [{ item: "V03", size: "M", qty: 1 }]).id;
  const other = { ...comment("c2", "chốt V03 size M"), buyerExternalId: "b2", buyerName: "Mai" };

  await pipeline.push(comment("c1", "đổi sang L"));
  await pipeline.push(other);
  await pipeline.drain(session.id);

  expect(sink.onError.mock.calls).toEqual([[session.id, expect.any(Error), [expect.objectContaining({ id: "c1" })]]]);
  expect(sink.onVerdict.mock.calls).toContainEqual([session.id, "c1", "unparsed"]);
  expect(sink.onVerdict.mock.calls).toContainEqual([session.id, "c2", "create", expect.any(String)]);
  expect(gateway.listOrders().filter((o) => o.buyer.externalId === "b2")).toHaveLength(1);
});
