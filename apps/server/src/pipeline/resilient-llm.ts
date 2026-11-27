import type { LlmClient } from "./llm.ts";

/**
 * Bọc nhiều LLM client (ví dụ nhiều model Gemini + OpenAI) để chịu được:
 * - Giới hạn request/phút (gói miễn phí Gemini: 15 RPM mỗi model) — tự giới hạn trước khi bị 429.
 * - 429: tạm nghỉ model đó đúng `retryDelay` mà API trả về, chuyển sang model khác.
 * - 503 "high demand" / timeout / lỗi mạng: tạm nghỉ model đó 30 giây, chuyển model khác.
 * Hết model rảnh thì chờ model sớm rảnh nhất (tối đa `maxWaitMs`), quá thì báo lỗi.
 */
export interface ResilientEntry {
  client: LlmClient;
  /** Số request tối đa mỗi phút; 0 = không giới hạn. */
  rpm: number;
}

interface State {
  entry: ResilientEntry;
  calls: number[]; // thời điểm gọi trong 60s gần nhất
  cooldownUntil: number;
}

export interface ResilientOptions {
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const MINUTE = 60_000;

export class ResilientLlm implements LlmClient {
  readonly name: string;
  private readonly states: State[];
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(entries: ResilientEntry[], opts: ResilientOptions = {}) {
    if (!entries.length) throw new Error("ResilientLlm cần ít nhất một client");
    this.states = entries.map((entry) => ({ entry, calls: [], cooldownUntil: 0 }));
    this.name = entries.map((e) => e.client.name).join(" → ");
    this.maxWaitMs = opts.maxWaitMs ?? 25_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? ((m) => console.warn(`[llm] ${m}`));
  }

  /** Thời điểm sớm nhất client này nhận thêm request. */
  private readyAt(s: State, t: number): number {
    s.calls = s.calls.filter((c) => t - c < MINUTE);
    let at = Math.max(t, s.cooldownUntil);
    if (s.entry.rpm > 0 && s.calls.length >= s.entry.rpm) at = Math.max(at, s.calls[0]! + MINUTE);
    return at;
  }

  async completeJson(system: string, user: string, opts?: { signal?: AbortSignal }): Promise<string> {
    const deadline = this.now() + this.maxWaitMs;
    const tried = new Set<State>();
    let lastError: unknown;

    for (;;) {
      const t = this.now();
      // Ưu tiên theo thứ tự cấu hình, chỉ lấy client rảnh ngay và chưa thử trong lượt này.
      const ready = this.states.find((s) => !tried.has(s) && this.readyAt(s, t) <= t);
      if (!ready) {
        const untried = this.states.filter((s) => !tried.has(s));
        const pool = untried.length ? untried : this.states;
        const next = Math.min(...pool.map((s) => this.readyAt(s, t)));
        if (next > deadline) throw new Error(`Không còn LLM nào rảnh trong ${this.maxWaitMs}ms: ${String(lastError ?? "rate limit")}`);
        if (!untried.length) tried.clear(); // đã thử hết: chờ rồi thử lại từ đầu
        await this.sleep(Math.max(50, next - t));
        continue;
      }

      ready.calls.push(t);
      tried.add(ready);
      try {
        return await ready.entry.client.completeJson(system, user, opts);
      } catch (err) {
        lastError = err;
        const kind = classify(err);
        if (kind === "fatal") throw err;
        const pause = kind === "rate_limit" ? (retryDelayMs(err) ?? 20_000) : 30_000;
        ready.cooldownUntil = this.now() + pause;
        this.log(`${ready.entry.client.name}: ${kind}, nghỉ ${Math.round(pause / 1000)}s`);
      }
    }
  }
}

type ErrorKind = "rate_limit" | "unavailable" | "fatal";

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

export function classify(err: unknown): ErrorKind {
  const status = statusOf(err);
  const msg = String((err as Error)?.message ?? err);
  if (status === 429 || /\b429\b|quota|rate limit/i.test(msg)) return "rate_limit";
  // 404: model bị gỡ / không mở cho tài khoản này — bỏ qua model đó, dùng model khác.
  if (status === undefined || status >= 500 || status === 408 || status === 404) return "unavailable"; // mạng, timeout, 5xx
  if (/timed out|timeout|ECONN|network|Connection error/i.test(msg)) return "unavailable";
  return "fatal"; // 400/401/403/404: cấu hình sai, thử lại vô ích
}

/** Đọc "retryDelay":"17s" trong body lỗi của Gemini. */
export function retryDelayMs(err: unknown): number | undefined {
  const m = String((err as Error)?.message ?? err).match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : undefined;
}
