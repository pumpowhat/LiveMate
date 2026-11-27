/**
 * So sánh các LLM trên bộ bình luận mẫu (fixtures/eval-cases.json).
 *
 *   pnpm --filter @livemate/server eval                # mọi provider có key trong .env
 *   pnpm --filter @livemate/server eval -- --only c13,c25 --repeat 2
 *
 * Mỗi case chạy qua ĐỦ pipeline (lọc -> LLM -> quy tắc -> InMemoryOrderGateway).
 * Chấm theo trạng thái cuối: các dòng hàng của từng người mua + những bình luận
 * được shop trả lời. Đáp án = chạy cùng pipeline với "LLM giả" trả về `expected`.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Comment, LiveSession, Order, Product } from "@livemate/shared";
import { llmClientsFromEnv, type LlmClient } from "../src/pipeline/llm.ts";
import { InMemoryOrderGateway } from "../src/pipeline/memory-gateway.ts";
import { CommentPipeline, type PipelineSink } from "../src/pipeline/pipeline.ts";

interface EvalCase {
  id: string;
  tag: string;
  featured: string | null;
  existingOrders: Record<string, { item: string; size: string | null; qty: number }[]>;
  comments: { id: string; buyer: string; text: string }[];
  expected: Record<string, unknown>[];
  note?: string;
}

interface CaseState {
  orders: string[]; // "buyer: 2x V03/L" đã sắp xếp
  replied: string[]; // commentId được trả lời
}

interface CaseRun {
  state: CaseState;
  latencies: number[];
  error?: string;
  raw: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const catalog: Product[] = JSON.parse(readFileSync(join(here, "../fixtures/catalog.json"), "utf8"));
const allCases: EvalCase[] = JSON.parse(readFileSync(join(here, "../fixtures/eval-cases.json"), "utf8"));

const args = process.argv.slice(2);
const argOf = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argOf("--only")?.split(",");
const repeat = Number(argOf("--repeat") ?? 1);
const concurrency = Number(argOf("--concurrency") ?? 4);
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;

/** LLM giả: trả về đúng `expected` của case. */
class ExpectedLlm implements LlmClient {
  readonly name = "expected";
  constructor(private readonly actions: unknown[]) {}
  async completeJson(): Promise<string> {
    return JSON.stringify({ actions: this.actions.map((a) => ({ reply: "(đáp án)", ...(a as object) })) });
  }
}

/** Bọc client thật để đo độ trễ và giữ output thô. */
class Recording implements LlmClient {
  latencies: number[] = [];
  raw: string[] = [];
  constructor(private readonly inner: LlmClient) {}
  get name() {
    return this.inner.name;
  }
  async completeJson(system: string, user: string): Promise<string> {
    const t = performance.now();
    try {
      const out = await this.inner.completeJson(system, user);
      this.raw.push(out);
      return out;
    } finally {
      this.latencies.push(performance.now() - t);
    }
  }
}

async function runCase(c: EvalCase, llm: LlmClient): Promise<CaseRun> {
  const byCode = new Map(catalog.map((p) => [p.code, p]));
  // Món "hồi nãy" = các món người mua đã có trong đơn, khác món đang giới thiệu.
  const previouslyFeatured = [...new Set(Object.values(c.existingOrders).flat().map((l) => l.item))].filter((x) => x !== c.featured);
  const session: LiveSession = {
    id: `s_${c.id}`,
    roomCode: c.id,
    status: "live",
    featuredProductId: c.featured ? (byCode.get(c.featured)?.id ?? null) : null,
    facebookObjectId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const gw = new InMemoryOrderGateway({ session, catalog, previouslyFeatured });
  for (const [buyer, lines] of Object.entries(c.existingOrders)) {
    gw.seedOrder({ externalId: buyer, name: buyer, source: "room" }, lines);
  }

  const replied = new Set<string>();
  let error: string | undefined;
  const sink: PipelineSink = {
    onVerdict() {},
    onOrder() {},
    onReply(_s, comment) {
      replied.add(comment.id);
    },
    onNeedsReview() {},
    onError(_s, err) {
      error = String(err);
    },
  };
  const rec = new Recording(llm);
  const pipeline = new CommentPipeline(rec, gw, sink, { batchWindowMs: 60_000, maxBatchSize: 100 });
  const now = Date.now();
  for (const [i, m] of c.comments.entries()) {
    const comment: Comment = {
      id: m.id,
      sessionId: session.id,
      source: "room",
      buyerExternalId: m.buyer,
      buyerName: m.buyer,
      text: m.text,
      createdAt: new Date(now + i * 1000).toISOString(),
    };
    await pipeline.push(comment);
  }
  await pipeline.drain(session.id);

  const orders = gw
    .listOrders()
    .filter((o: Order) => o.status !== "cancelled")
    .flatMap((o: Order) => o.items.map((i) => `${o.buyer.externalId}: ${i.qty}x ${i.productCode}${i.size ? `/${i.size}` : ""}`))
    .sort();
  return { state: { orders, replied: [...replied].sort() }, latencies: rec.latencies, error, raw: rec.raw };
}

const same = (a: CaseState, b: CaseState) => JSON.stringify(a) === JSON.stringify(b);

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function main() {
  const clients = llmClientsFromEnv();
  if (!clients.length) {
    console.error("Chưa có LLM nào: điền GEMINI_API_KEY+GEMINI_MODEL và/hoặc OPENAI_API_KEY+OPENAI_MODEL vào apps/server/.env");
    process.exit(1);
  }

  // Đáp án: chạy pipeline với LLM giả. Case nào đáp án tự mâu thuẫn với quy tắc vẫn chấm theo kết quả này.
  const expected = new Map<string, CaseState>();
  for (const c of cases) expected.set(c.id, (await runCase(c, new ExpectedLlm(c.expected))).state);

  const outDir = join(here, "../eval-results");
  mkdirSync(outDir, { recursive: true });
  const summary: string[] = [];

  for (const llm of clients) {
    const jobs = cases.flatMap((c) => Array.from({ length: repeat }, () => c));
    console.log(`\n▶ ${llm.name}: ${jobs.length} lượt`);
    const runs = await pool(jobs, concurrency, async (c) => ({ c, run: await runCase(c, llm) }));

    const latencies = runs.flatMap((r) => r.run.latencies);
    const byTag = new Map<string, { ok: number; n: number }>();
    const failures: unknown[] = [];
    let ok = 0;
    let errors = 0;
    for (const { c, run } of runs) {
      const pass = !run.error && same(run.state, expected.get(c.id)!);
      if (pass) ok++;
      if (run.error) errors++;
      const t = byTag.get(c.tag) ?? { ok: 0, n: 0 };
      t.n++;
      if (pass) t.ok++;
      byTag.set(c.tag, t);
      if (!pass) failures.push({ id: c.id, tag: c.tag, comments: c.comments, expected: expected.get(c.id), got: run.state, error: run.error, raw: run.raw, note: c.note });
    }
    const line = `${llm.name.padEnd(36)} đúng ${ok}/${runs.length} (${((100 * ok) / runs.length).toFixed(0)}%)  lỗi ${errors}  trễ p50 ${pct(latencies, 50).toFixed(0)}ms p95 ${pct(latencies, 95).toFixed(0)}ms`;
    summary.push(line);
    console.log(line);
    console.log("  theo nhóm: " + [...byTag].map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(", "));
    const file = join(outDir, `${llm.name.replace(/[^\w.-]+/g, "_")}.json`);
    writeFileSync(file, JSON.stringify(failures, null, 2));
    console.log(`  case sai: ${file}`);
  }
  console.log("\n=== Tổng kết ===\n" + summary.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
