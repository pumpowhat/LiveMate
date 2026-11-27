import OpenAI from "openai";
import { FakeRegexLlm } from "./fake-llm.ts";

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
      timeout: cfg.timeoutMs ?? 15_000,
      maxRetries: 1,
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

/** Đọc cấu hình từ env. Trả về các client có đủ key + model. */
export function llmClientsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient[] {
  const clients: LlmClient[] = [];
  if (env.GEMINI_API_KEY && env.GEMINI_MODEL) {
    clients.push(
      new OpenAiCompatibleClient({ name: "gemini", apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, baseURL: GEMINI_OPENAI_BASE_URL }),
    );
  }
  if (env.OPENAI_API_KEY && env.OPENAI_MODEL) {
    clients.push(new OpenAiCompatibleClient({ name: "openai", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }));
  }
  return clients;
}

/** Client chính cho pipeline: LLM_PROVIDER=gemini|openai (mặc định: client đầu tiên có cấu hình). */
export function primaryLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const wanted = env.LLM_PROVIDER;
  if (wanted === "fake") return new FakeRegexLlm();
  const all = llmClientsFromEnv(env);
  const picked = wanted ? all.find((c) => c.name.startsWith(`${wanted}:`)) : all[0];
  if (!picked) throw new Error("Chưa cấu hình LLM: cần GEMINI_API_KEY+GEMINI_MODEL hoặc OPENAI_API_KEY+OPENAI_MODEL");
  return picked;
}
