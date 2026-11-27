import { describe, expect, it } from "vitest";
import { crc16ccitt } from "./crc16.ts";
import { buildVietQrPayload, vietQrPngBuffer, vietQrPngDataUrl } from "./vietqr.ts";
import type { VietQrInput } from "./vietqr.ts";

const input: VietQrInput = {
  bankBin: "970436",
  accountNumber: "00123ABC",
  amount: 150_000,
  addInfo: "Đơn hàng A12",
};

function parseTlv(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let offset = 0;

  while (offset < payload.length) {
    const header = payload.slice(offset, offset + 4);
    expect(header).toMatch(/^\d{4}$/);

    const id = header.slice(0, 2);
    const length = Number(header.slice(2));
    const value = payload.slice(offset + 4, offset + 4 + length);
    expect(value.length).toBe(length);
    expect(fields).not.toHaveProperty(id);

    fields[id] = value;
    offset += 4 + length;
  }

  expect(offset).toBe(payload.length);
  return fields;
}

describe("crc16ccitt", () => {
  it.each([
    ["123456789", "29B1"],
    ["đ", "5407"],
  ])("computes the CRC-16/CCITT-FALSE of %s", (text, expected) => {
    expect(crc16ccitt(text)).toBe(expected);
  });
});

describe("VietQR", () => {
  it("encodes a dynamic NAPAS 247 transfer with valid TLV lengths and CRC", () => {
    const payload = buildVietQrPayload(input);
    expect(payload.startsWith("000201010212")).toBe(true);
    expect(payload).toContain("0010A000000727");
    expect(payload).toContain("5303704");
    expect(payload).toContain("5406150000");
    expect(payload).toContain("5802VN");
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16ccitt(payload.slice(0, -4)));

    const fields = parseTlv(payload);
    expect(fields).toEqual({
      "00": "01",
      "01": "12",
      "38": expect.any(String),
      "53": "704",
      "54": "150000",
      "58": "VN",
      "62": expect.any(String),
      "63": payload.slice(-4),
    });
    const merchant = parseTlv(fields["38"] ?? "");
    expect(merchant).toEqual({
      "00": "A000000727",
      "01": expect.any(String),
      "02": "QRIBFTTA",
    });
    expect(parseTlv(merchant["01"] ?? "")).toEqual({
      "00": input.bankBin,
      "01": input.accountNumber,
    });
    expect(parseTlv(fields["62"] ?? "")).toEqual({ "08": "Don hang A12" });
  });

  it("filters transfer notes, collapses spaces, and truncates to 25 characters", () => {
    const payload = buildVietQrPayload({
      ...input,
      addInfo: "  đợi!   ABCDEFGHIJKLMNOPQRSTUVWXYZ  ",
    });
    expect(parseTlv(parseTlv(payload)["62"] ?? "")).toEqual({
      "08": "doi ABCDEFGHIJKLMNOPQRSTU",
    });
  });

  it("encodes the maximum allowed amount as an integer", () => {
    const payload = buildVietQrPayload({ ...input, amount: 99_999_999_999 });
    expect(parseTlv(payload)["54"]).toBe("99999999999");
  });

  it.each([
    { field: "bankBin", value: "97043" },
    { field: "bankBin", value: "97043A" },
    { field: "accountNumber", value: "" },
    { field: "accountNumber", value: "123-456" },
    { field: "accountNumber", value: "12345678901234567890" },
    { field: "amount", value: 0 },
    { field: "amount", value: -1 },
    { field: "amount", value: 1.5 },
    { field: "amount", value: Infinity },
    { field: "amount", value: 100_000_000_000 },
    { field: "addInfo", value: null },
  ])("rejects invalid $field ($value)", ({ field, value }) => {
    expect(() => buildVietQrPayload({ ...input, [field]: value })).toThrow(field);
  });

  it("renders a 360-pixel PNG as both a data URL and a buffer", async () => {
    const [dataUrl, buffer] = await Promise.all([
      vietQrPngDataUrl(input),
      vietQrPngBuffer(input),
    ]);

    expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(buffer.readUInt32BE(16)).toBe(360);
    expect(buffer.readUInt32BE(20)).toBe(360);
    expect(dataUrl).toBe(`data:image/png;base64,${buffer.toString("base64")}`);
  });
});
