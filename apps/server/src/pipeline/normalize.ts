/** Bỏ dấu tiếng Việt, chữ thường, gộp khoảng trắng. "Chốt ĐẦM" -> "chot dam". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
