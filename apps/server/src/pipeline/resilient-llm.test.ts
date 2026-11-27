import { describe, it, expect } from "vitest";
import { ResilientLlm, classify, retryDelayMs } from "./resilient-llm.ts";
import type { LlmClient } from "./llm.ts";

function makeClient(name: string, behaviours: Array<"ok" | Error>): LlmClient & { calls: number } {
  const queue = [...behaviours];
  const client: LlmClient & { calls: number } = {
    name,
    calls: 0,
    async completeJson(): Promise<string> {
      client.calls += 1;
      const next = queue.shift();
      if (!next) throw new Error(`No more behaviours configured for ${name}`);
      if (next === "ok") return JSON.stringify({ from: name });
      throw next;
    },
  };
  return client;
}

const rateLimit = (sec: number) =>
  Object.assign(new Error(`429 [{"error":{"code":429,"details":[{"retryDelay":"${sec}s"}]}}]`), { status: 429 });
const unavailable = () => Object.assign(new Error("503 high demand"), { status: 503 });
const timeout = () => new Error("Request timed out.");
const badRequest = () => Object.assign(new Error("400 bad"), { status: 400 });

describe("ResilientLlm", () => {
  it("returns first client result when ok; second client not called", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", ["ok"]);
    const c2 = makeClient("c2", ["ok"]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { now, sleep, log: () => {} },
    );

    const res = await llm.completeJson("sys", "usr");
    expect(res).toBe('{"from":"c1"}');
    expect(c1.calls).toBe(1);
    expect(c2.calls).toBe(0);
  });

  it("on 429 from first client, falls back to second client in the same call", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", [rateLimit(17)]);
    const c2 = makeClient("c2", ["ok"]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { now, sleep, log: () => {} },
    );

    const res = await llm.completeJson("sys", "usr");
    expect(res).toBe('{"from":"c2"}');
    expect(c1.calls).toBe(1);
    expect(c2.calls).toBe(1);
  });

  it("after a 429 with retryDelay 17s, first client is skipped until t >= 17500", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", [rateLimit(17), "ok"]);
    const c2 = makeClient("c2", ["ok", "ok"]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { now, sleep, log: () => {} },
    );

    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');

    t = 5000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');
    expect(c1.calls).toBe(1);
    expect(c2.calls).toBe(2);

    t = 20000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c1"}');
    expect(c1.calls).toBe(2);
    expect(c2.calls).toBe(2);
  });

  it("503 and timeout both fall back and put the client on 30s cooldown", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", [unavailable(), timeout(), "ok"]);
    const c2 = makeClient("c2", ["ok", "ok", "ok", "ok"]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { now, sleep, log: () => {} },
    );

    // 503 at t=0 -> falls back to c2, c1 cools down until 30_000
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');
    t = 29_000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');
    expect(c1.calls).toBe(1);

    // At t=30_000 c1 is ready again, hits timeout -> falls back to c2, c1 cools down until 60_000
    t = 30_000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');
    expect(c1.calls).toBe(2);

    t = 59_000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c2"}');
    expect(c1.calls).toBe(2);

    t = 60_000;
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c1"}');
    expect(c1.calls).toBe(3);
  });

  it("400 (fatal) is rethrown immediately without trying the second client", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", [badRequest()]);
    const c2 = makeClient("c2", ["ok"]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { now, sleep, log: () => {} },
    );

    await expect(llm.completeJson("sys", "usr")).rejects.toThrow("400 bad");
    expect(c1.calls).toBe(1);
    expect(c2.calls).toBe(0);
  });

  it("rpm limit: single client with rpm 2 runs two calls immediately and third waits until t >= 60000", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", ["ok", "ok", "ok"]);
    const llm = new ResilientLlm([{ client: c1, rpm: 2 }], { maxWaitMs: 70_000, now, sleep, log: () => {} });

    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c1"}');
    expect(t).toBe(0);
    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c1"}');
    expect(t).toBe(0);

    expect(await llm.completeJson("sys", "usr")).toBe('{"from":"c1"}');
    expect(t).toBeGreaterThanOrEqual(60_000);
    expect(c1.calls).toBe(3);
  });

  it("all clients cooling down longer than maxWaitMs rejects with 'Không còn LLM nào rảnh'", async () => {
    let t = 0;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };

    const c1 = makeClient("c1", [rateLimit(17)]);
    const c2 = makeClient("c2", [unavailable()]);
    const llm = new ResilientLlm(
      [
        { client: c1, rpm: 0 },
        { client: c2, rpm: 0 },
      ],
      { maxWaitMs: 1000, now, sleep, log: () => {} },
    );

    await expect(llm.completeJson("sys", "usr")).rejects.toThrow(/Không còn LLM nào rảnh/);
  });
});

describe("classify", () => {
  it("classifies rate_limit, unavailable, and fatal errors", () => {
    expect(classify(rateLimit(5))).toBe("rate_limit");
    expect(classify(new Error("You exceeded your current quota"))).toBe("rate_limit");
    expect(classify(unavailable())).toBe("unavailable");
    expect(classify(Object.assign(new Error("not found"), { status: 404 }))).toBe("unavailable");
    expect(classify(new Error("some unknown failure"))).toBe("unavailable");
    expect(classify(badRequest())).toBe("fatal");
  });
});

describe("retryDelayMs", () => {
  it("parses retryDelay seconds and adds 500ms buffer, or returns undefined when absent", () => {
    expect(retryDelayMs(rateLimit(17))).toBe(17500);
    expect(retryDelayMs(new Error('{"retryDelay":"0.5s"}'))).toBe(1000);
    expect(retryDelayMs(new Error("no retry delay here"))).toBeUndefined();
  });
});
