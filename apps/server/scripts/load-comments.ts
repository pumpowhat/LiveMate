import { readFileSync } from "node:fs";
import type { OrderItem, Product } from "@livemate/shared";

type Variant = { code: string; size: string; stock: number };
const catalog: Product[] = JSON.parse(readFileSync(new URL("../fixtures/catalog.json", import.meta.url), "utf8"));
const variants: Variant[] = catalog.flatMap(({ code, sizes, stock }) =>
  (sizes.length ? sizes : [""]).flatMap((size) => {
    const available = stock[size] ?? 0;
    return available > 0 ? [{ code, size, stock: available }] : [];
  }),
);

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function createCommentGenerator(random: () => number) {
  if (!variants.length) throw new Error("The catalog fixture has no stocked items");
  const pick = <T>(choices: readonly T[]) => choices[Math.floor(random() * choices.length)]!;

  return (sentBefore: boolean, items: readonly OrderItem[]): string => {
    const intent = random();
    if (intent < 0.25) return pick(["đẹp quá shop ơi", "hello", "xinh ghê", "shop nay live vui quá"]);

    const { code, size, stock } = pick(variants);
    const label = size ? `${code} size ${size}` : code;
    if (sentBefore && intent < 0.40) {
      return size ? `${code} còn size ${size} ko shop?` : `${code} còn hàng ko shop?`;
    }
    if (sentBefore && items.length) {
      if (intent < 0.50) return pick(["thôi hủy nha", "shop ơi hủy đơn giúp em", "thoi huy nha shop"]);

      const item = pick(items);
      if (intent < 0.70) {
        // The code identifies the old line when the buyer has several items.
        const alternatives = variants.filter((v) =>
          v.code === item.productCode && v.size !== (item.size ?? "") && v.stock >= item.qty,
        );
        const ambiguous = items.some((other) => other !== item && other.productCode === item.productCode);
        if (alternatives.length && !ambiguous) {
          return `đổi ${item.productCode} sang size ${pick(alternatives).size} nha shop`;
        }
      }
      if (intent < 0.88) {
        const variant = variants.find((v) => v.code === item.productCode && v.size === (item.size ?? ""));
        if (variant && variant.stock > item.qty) {
          const itemLabel = item.size ? `${item.productCode} size ${item.size}` : item.productCode;
          return `shop ơi lấy thêm 1 cái ${itemLabel} nữa nha`;
        }
      }
    }

    return pick([
      `chốt ${label}`,
      `e lấy ${stock >= 2 ? 2 : 1}c ${code}${size ? ` ${size}` : ""}`,
      `cho mình 1 ${label}`,
      `chot ${code.toLowerCase()}${size ? ` sz ${size.toLowerCase()}` : ""}`,
    ]);
  };
}
