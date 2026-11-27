import { AiAction } from "@livemate/shared";
import type { LlmClient } from "./llm.ts";
import { buildUserPrompt, SYSTEM_PROMPT, type PromptContext } from "./prompt.ts";

export interface ExtractResult {
  actions: AiAction[];
  /** Hành động LLM trả về nhưng sai schema (bị bỏ). */
  rejected: unknown[];
  latencyMs: number;
  attempts: number;
}

function parseJson(raw: string): unknown {
  // Một số model bọc JSON trong ```json ... ```
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

/**
 * Gọi LLM cho một lô bình luận. Validate từng hành động riêng lẻ để một hành
 * động hỏng không làm mất cả lô; thử lại một lần nếu JSON hỏng hoàn toàn.
 */
export async function extractActions(llm: LlmClient, ctx: PromptContext): Promise<ExtractResult> {
  const user = buildUserPrompt(ctx);
  const commentIds = new Set(ctx.comments.map((c) => c.id));
  const buyerOf = new Map(ctx.comments.map((c) => [c.id, c.buyer]));
  const started = performance.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let parsed: unknown;
    try {
      parsed = parseJson(await llm.completeJson(SYSTEM_PROMPT, user));
    } catch (err) {
      lastError = err;
      continue;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)
        ? (parsed as { actions: unknown[] }).actions
        : null;
    if (!list) {
      lastError = new Error("LLM response has no actions array");
      continue;
    }

    const actions: AiAction[] = [];
    const rejected: unknown[] = [];
    for (const raw of list) {
      const r = AiAction.safeParse(fillDefaults(raw));
      if (!r.success || !commentIds.has(r.data.commentId)) {
        rejected.push(raw);
        continue;
      }
      // Không tin buyer do LLM ghi: luôn lấy từ bình luận gốc.
      actions.push({ ...r.data, buyer: buyerOf.get(r.data.commentId)! });
    }
    return { actions, rejected, latencyMs: performance.now() - started, attempts: attempt };
  }
  throw new Error(`LLM extraction failed after 2 attempts: ${String(lastError)}`);
}

/** Điền null cho các trường tùy chọn model hay bỏ sót, và chuẩn hóa size/mã viết hoa. */
function fillDefaults(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const a = { ...(raw as Record<string, unknown>) };
  const up = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
  if (typeof a.qty === "string" && /^\d+$/.test(a.qty)) a.qty = Number(a.qty);
  switch (a.action) {
    case "create":
      a.size ??= null;
      a.qty ??= 1;
      break;
    case "update":
      a.size ??= null;
      a.qty ??= null;
      a.newItem ??= null;
      break;
    case "cancel":
      a.item ??= null;
      break;
  }
  for (const k of ["item", "newItem", "size"]) if (a[k] === "") a[k] = null;
  for (const k of ["item", "newItem", "size"]) a[k] = up(a[k]);
  return a;
}
