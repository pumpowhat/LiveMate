import { fold } from "./normalize.ts";

/**
 * Bước [1]: lọc nhanh bình luận có ý định đặt hàng / hỏi hàng.
 * Nghiêng về cho qua: để lọt còn hơn sót đơn. Chỉ bỏ những câu chắc chắn là
 * khen / chào / cảm thán mà không có tín hiệu mua hàng nào.
 */

// Từ khóa (đã bỏ dấu). Dùng \b để "lay" không khớp "play" v.v.
const INTENT_WORDS = [
  "chot", "lay", "mua", "dat", "xin", "ib", "inbox", "order", "oder",
  "size", "sz", "sai",
  "huy", "doi", "them", "bot", "bo", "thoi", "khong lay", "ko lay", "k lay",
  "gia", "bao nhieu", "bn", "bnh", "con", "het", "ship",
  "cai nay", "mau nay", "cai do", "hoi nay", "luc nay", "cai kia",
  "cho e", "cho em", "cho minh", "cho chi", "cho a", "cho anh", "em lay", "e lay",
  "cai", "chiec", "bo",
];
const INTENT_RE = new RegExp(`\\b(${INTENT_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`);

// Size đứng riêng: s m l xl xxl 2xl 3xl, hoặc số size quần 25-34.
const SIZE_RE = /\b(xs|s|m|l|xl|xxl|xxxl|[2-4]xl|2[5-9]|3[0-4])\b/;
// Số lượng: "2c", "2 cai", "x2", "sl 3".
const QTY_RE = /\b(\d+\s*(c|cai|chiec|bo|doi)|x\s*\d+|sl\s*\d+)\b/;
const QUESTION_RE = /\?|\b(ko|khong|k|hong|hok|ha|a shop)\s*$/;

export interface FilterContext {
  /** Mã món trong danh mục, ví dụ ["V03","A01"]. */
  productCodes: string[];
  /** Người bình luận đã có đơn trong phiên — câu ngắn như "thôi nha" vẫn có thể là hủy. */
  buyerHasOrder: boolean;
}

export type FilterResult = { pass: true; reason: string } | { pass: false; reason: string };

export function prefilter(text: string, ctx: FilterContext): FilterResult {
  const t = fold(text);
  if (t.length === 0) return { pass: false, reason: "empty" };

  const codeRe = ctx.productCodes.length
    ? new RegExp(`\\b(${ctx.productCodes.map((c) => fold(c)).join("|")})\\b`)
    : null;
  if (codeRe?.test(t)) return { pass: true, reason: "product_code" };
  if (INTENT_RE.test(t)) return { pass: true, reason: "keyword" };
  if (QTY_RE.test(t)) return { pass: true, reason: "quantity" };
  if (SIZE_RE.test(t)) return { pass: true, reason: "size" };
  if (QUESTION_RE.test(t)) return { pass: true, reason: "question" };
  // Có đơn rồi thì mọi câu ngắn đều có thể là sửa/hủy ("thôi nha", "L nha shop").
  if (ctx.buyerHasOrder && t.length <= 40) return { pass: true, reason: "has_order" };
  // Câu chỉ toàn số ("2", "3") thường là số lượng trả lời shop.
  if (/^\d{1,2}$/.test(t)) return { pass: true, reason: "bare_number" };

  return { pass: false, reason: "no_signal" };
}
