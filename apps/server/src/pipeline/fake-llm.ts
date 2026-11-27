import type { LlmClient } from "./llm.ts";
import { fold } from "./normalize.ts";

/**
 * "LLM" giả bằng regex cho dev/frontend khi chưa có API key (LLM_PROVIDER=fake).
 * Chỉ hiểu câu đơn giản: mã món hoặc món đang giới thiệu, size, số lượng, hủy, đổi size, câu hỏi.
 * KHÔNG dùng để đánh giá chất lượng.
 */
export class FakeRegexLlm implements LlmClient {
  readonly name = "fake:regex";

  async completeJson(_system: string, user: string): Promise<string> {
    const codes = [...user.matchAll(/^([A-Z]\d{2}) \| /gm)].map((m) => m[1]!);
    const featured = user.match(/^ĐANG GIỚI THIỆU: ([A-Z]\d{2})/m)?.[1] ?? null;
    const actions: unknown[] = [];

    for (const m of user.matchAll(/^\[([^\]]+)\] (.+?): (.*)$/gm)) {
      const [, commentId, buyer, raw] = m as unknown as [string, string, string, string];
      const t = fold(raw);
      const code = codes.find((c) => new RegExp(`\\b${c.toLowerCase()}\\b`).test(t)) ?? featured;
      const size = t.match(/\b(?:size|sz)?\s*(xs|s|m|l|xl|xxl|2[5-9]|3[0-4])\b/)?.[1]?.toUpperCase() ?? null;
      const qty = Number(t.match(/\b(\d+)\s*(?:c|cai|chiec)\b/)?.[1] ?? 1);

      if (/\b(huy|khong lay|ko lay|bo)\b/.test(t)) actions.push({ commentId, buyer, action: "cancel", item: codes.find((c) => t.includes(c.toLowerCase())) ?? null });
      else if (/\?|\b(gia|bao nhieu|con)\b/.test(t)) actions.push({ commentId, buyer, action: "ask", reply: "Shop trả lời ngay nhé ạ (chế độ dev)." });
      else if (/\bdoi\b/.test(t) && code) actions.push({ commentId, buyer, action: "update", item: code, size, qty: null, newItem: null });
      else if (code && /\b(chot|lay|mua|xin|cho|ib|dat)\b|\b[a-z]\d{2}\b/.test(t)) actions.push({ commentId, buyer, action: "create", item: code, size, qty });
    }
    return JSON.stringify({ actions });
  }
}
