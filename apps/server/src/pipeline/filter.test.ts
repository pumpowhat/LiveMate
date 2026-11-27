import { expect, test } from "vitest";
import { prefilter } from "./filter.ts";

const productCodes = ["V03", "V05"];

test.each([
  ["chốt váy này size M", false],
  ["e lấy 2c áo đen L", false],
  ["chot V03 sz m", false],
  ["thôi hủy nha", true],
  ["còn size XL ko shop", false],
  ["2", false],
  ["V05", false],
] as const)("passes %s", (text, buyerHasOrder) => {
  expect(prefilter(text, { productCodes, buyerHasOrder }).pass).toBe(true);
});

test.each(["đẹp quá shop ơi", "hello mọi người", "xinh xỉu"])("ignores %s", (text) => {
  expect(prefilter(text, { productCodes, buyerHasOrder: false }).pass).toBe(false);
});
