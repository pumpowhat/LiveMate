import OpenAI from "openai";
import { FakeRegexLlm } from "./fake-llm.ts";
import { ResilientLlm, type ResilientEntry } from "./resilient-llm.ts";

/** Một lần gọi LLM: system + user -> chuỗi JSON. */
export interface LlmClient {
  readonly name: string;
  completeJson(system: string, user: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

export interface OpenAiCompatibleConfig {
  name: string;
  apiKey: string;
  model: string;
  /** Bỏ trống cho OpenAI; Gemini dùng endpoint tương thích OpenAI. */
  baseURL?: string;
  timeoutMs?: number;
}

export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Dùng chung cho OpenAI và Gemini (qua endpoint tương thích OpenAI). */
export class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(cfg: OpenAiCompatibleConfig) {
    this.name = `${cfg.name}:${cfg.model}`;
    this.model = cfg.model;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      timeout: cfg.timeoutMs ?? 10_000,
      // ResilientLlm lo việc thử lại / chuyển model; SDK không tự retry để khỏi chờ vô ích.
      maxRetries: 0,
    });
  }

  async completeJson(system: string, user: string, opts?: { signal?: AbortSignal }): Promise<string> {
    const res = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      },
      opts?.signal ? { signal: opts.signal } : undefined,
    );
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error(`${this.name}: empty response`);
    return content;
  }
}

const splitModels = (v: string | undefined) => (v ?? "").split(",").map((m) => m.trim()).filter(Boolean);

/**
 * Đọc cấu hình từ env. GEMINI_MODEL / OPENAI_MODEL nhận danh sách phân tách bằng dấu phẩy,
 * ví dụ GEMINI_MODEL=gemini-3.5-flash-lite,gemini-3.5-flash (model đầu là ưu tiên).
 */
export function llmEntriesFromEnv(env: NodeJS.ProcessEnv = process.env): ResilientEntry[] {
  const entries: ResilientEntry[] = [];
  const gRpm = Number(env.GEMINI_RPM ?? 15);
  const oRpm = Number(env.OPENAI_RPM ?? 0);
  if (env.GEMINI_API_KEY) {
    for (const model of splitModels(env.GEMINI_MODEL)) {
      entries.push({ rpm: gRpm, client: new OpenAiCompatibleClient({ name: "gemini", apiKey: env.GEMINI_API_KEY, model, baseURL: GEMINI_OPENAI_BASE_URL }) });
    }
  }
  if (env.OPENAI_API_KEY) {
    for (const model of splitModels(env.OPENAI_MODEL)) {
      entries.push({ rpm: oRpm, client: new OpenAiCompatibleClient({ name: "openai", apiKey: env.OPENAI_API_KEY, model }) });
    }
  }
  return entries;
}

/** Từng model riêng lẻ (dùng cho eval: mỗi model một ResilientLlm để chờ quota thay vì báo lỗi). */
export function llmClientsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient[] {
  return llmEntriesFromEnv(env).map((e) => new ResilientLlm([e], { maxWaitMs: 90_000 }));
}

/**
 * Client cho pipeline: mọi model đã cấu hình, có giới hạn RPM và tự chuyển model khi lỗi.
 * LLM_PROVIDER=gemini|openai đưa provider đó lên đầu; LLM_PROVIDER=fake dùng regex (dev).
 */
export function primaryLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const wanted = env.LLM_PROVIDER;
  if (wanted === "fake") return new FakeRegexLlm();
  const entries = llmEntriesFromEnv(env);
  if (!entries.length) throw new Error("Chưa cấu hình LLM: cần GEMINI_API_KEY+GEMINI_MODEL hoặc OPENAI_API_KEY+OPENAI_MODEL (hoặc LLM_PROVIDER=fake)");
  if (wanted) entries.sort((a, b) => Number(!a.client.name.startsWith(`${wanted}:`)) - Number(!b.client.name.startsWith(`${wanted}:`)));
  return new ResilientLlm(entries);
}
