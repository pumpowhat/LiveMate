import { z } from "zod";

/**
 * Hành động LLM trả về cho mỗi bình luận có ý định đặt hàng.
 * `commentId` nối hành động với bình luận gốc (một lô có nhiều bình luận).
 * `item` là mã món (Product.code), không phải id.
 */
const base = {
  commentId: z.string(),
  buyer: z.string().describe("buyerExternalId của người bình luận"),
};

export const CreateAction = z.object({
  ...base,
  action: z.literal("create"),
  item: z.string(),
  size: z.string().nullable(),
  qty: z.number().int().positive(),
});

/** Sửa một dòng hàng trong đơn hiện có của người mua. Chỉ các trường thay đổi khác null. */
export const UpdateAction = z.object({
  ...base,
  action: z.literal("update"),
  item: z.string(),
  size: z.string().nullable(),
  qty: z.number().int().positive().nullable(),
  /** Đổi sang món khác (ví dụ "đổi sang váy V05"). */
  newItem: z.string().nullable(),
});

/** Hủy một món (item khác null) hoặc toàn bộ đơn của người mua (item null). */
export const CancelAction = z.object({
  ...base,
  action: z.literal("cancel"),
  item: z.string().nullable(),
});

/** Câu hỏi hoặc câu mơ hồ: không đổi đơn, chỉ trả lời khách. */
export const AskAction = z.object({
  ...base,
  action: z.literal("ask"),
  reply: z.string(),
});

export const AiAction = z.discriminatedUnion("action", [CreateAction, UpdateAction, CancelAction, AskAction]);
export type AiAction = z.infer<typeof AiAction>;

export const AiResponse = z.object({ actions: z.array(AiAction) });
export type AiResponse = z.infer<typeof AiResponse>;
