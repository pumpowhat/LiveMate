import type { Product } from "@livemate/shared";

export interface PromptComment {
  id: string;
  buyer: string; // buyerExternalId
  name: string; // tên hiển thị
  text: string;
}

export interface PromptOrderLine {
  item: string; // mã món
  size: string | null;
  qty: number;
}

export interface PromptContext {
  catalog: Product[];
  /** Mã món đang giới thiệu. */
  featured: string | null;
  /** Các món giới thiệu trước đó, mới nhất trước — để hiểu "cái hồi nãy". */
  previouslyFeatured: string[];
  /** Đơn hiện có của các người mua trong lô. */
  orders: Record<string, PromptOrderLine[]>;
  comments: PromptComment[];
}

export const SYSTEM_PROMPT = `Bạn là trợ lý ghi đơn cho một shop bán hàng qua livestream ở Việt Nam.
Bạn đọc một lô bình luận của người mua và trả về các hành động đặt hàng dưới dạng JSON.

Người mua viết đủ kiểu: viết tắt, không dấu, sai chính tả, tiếng lóng ("chốt", "lấy", "cho e", "em xin", "ib", "sz", "2c" = 2 cái).

Hành động:
- "create": người mua muốn mua thêm một món. Trường: item, size, qty.
- "update": sửa một món ĐÃ CÓ trong đơn của người mua (đổi size, đổi số lượng, đổi sang món khác).
  Trường: item (mã món đang có trong đơn), size (size mới hoặc null nếu không đổi), qty (số lượng mới TỔNG, hoặc null), newItem (mã món mới hoặc null).
  "thêm 1 cái nữa" khi đang có 1 cái => qty = 2.
- "cancel": hủy một món (item = mã món) hoặc cả đơn (item = null).
- "ask": câu hỏi, hoặc câu đặt hàng chưa đủ thông tin (thiếu size với món có size, không rõ món nào, size không tồn tại).
  Trường reply: câu trả lời ngắn, lịch sự, xưng "shop", gọi khách là "bạn", dựa trên danh mục.

Quy tắc:
- item luôn là MÃ MÓN trong danh mục (ví dụ "V03"). Không bịa mã.
- "cái này", "mẫu này", hoặc chỉ nêu size/số lượng mà không nêu món => món đang giới thiệu.
- "cái hồi nãy", "cái lúc nãy" => món giới thiệu ngay trước đó.
- Size phải đúng một trong các size của món (viết hoa như danh mục). Món không có size => size = null.
- Không ghi số lượng => qty = 1. Số bằng chữ ("hai cái") => số.
- Nếu người mua đã có món đó trong đơn và nói đổi/sửa => "update", không tạo đơn mới.
- Không chắc chắn => "ask" thay vì đoán.
- Một bình luận có thể sinh nhiều hành động (ví dụ mua hai món). Bình luận chỉ khen/chào => không có hành động.
- Không kiểm tra tồn kho (hệ thống tự kiểm tra).
- commentId và buyer lấy đúng từ bình luận.

Chỉ trả về JSON dạng: {"actions": [ ... ]}
Ví dụ:
{"actions":[
 {"commentId":"m1","buyer":"lan.nguyen","action":"create","item":"V03","size":"M","qty":1},
 {"commentId":"m2","buyer":"lan.nguyen","action":"update","item":"V03","size":"L","qty":null,"newItem":null},
 {"commentId":"m3","buyer":"minh_t","action":"cancel","item":null},
 {"commentId":"m4","buyer":"hoa.tran","action":"ask","reply":"V03 chỉ có size S/M/L ạ"}
]}`;

function formatProduct(p: Product): string {
  const sizes = p.sizes.length ? `size ${p.sizes.join("/")}` : "không có size";
  return `${p.code} | ${p.name} | ${sizes} | ${p.price.toLocaleString("vi-VN")}đ`;
}

export function buildUserPrompt(ctx: PromptContext): string {
  const lines: string[] = [];
  lines.push("DANH MỤC:");
  for (const p of ctx.catalog) lines.push(formatProduct(p));
  lines.push("");
  const featured = ctx.featured ? ctx.catalog.find((p) => p.code === ctx.featured) : undefined;
  lines.push(`ĐANG GIỚI THIỆU: ${featured ? `${featured.code} (${featured.name})` : "không có"}`);
  if (ctx.previouslyFeatured.length) {
    lines.push(`GIỚI THIỆU TRƯỚC ĐÓ (mới nhất trước): ${ctx.previouslyFeatured.join(", ")}`);
  }
  lines.push("");
  lines.push("ĐƠN HIỆN CÓ:");
  const buyers = [...new Set(ctx.comments.map((c) => c.buyer))];
  let any = false;
  for (const b of buyers) {
    const items = ctx.orders[b];
    if (!items?.length) continue;
    any = true;
    lines.push(`${b}: ${items.map((i) => `${i.qty}x ${i.item}${i.size ? ` size ${i.size}` : ""}`).join("; ")}`);
  }
  if (!any) lines.push("(chưa có)");
  lines.push("");
  lines.push("BÌNH LUẬN (theo thứ tự thời gian):");
  for (const c of ctx.comments) lines.push(`[${c.id}] ${c.buyer}: ${c.text}`);
  return lines.join("\n");
}
