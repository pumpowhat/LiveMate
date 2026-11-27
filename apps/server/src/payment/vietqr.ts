import QRCode from "qrcode";
import { crc16ccitt } from "./crc16.ts";

export type VietQrInput = {
  bankBin: string;
  accountNumber: string;
  amount: number;
  addInfo: string;
};

const MAX_AMOUNT = 99_999_999_999;
const pngOptions = { errorCorrectionLevel: "M", margin: 2, width: 360 } as const;

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export function buildVietQrPayload(input: VietQrInput): string {
  const { bankBin, accountNumber, amount, addInfo } = input;

  if (typeof bankBin !== "string" || !/^\d{6}$/.test(bankBin)) {
    throw new Error("bankBin must be a string of exactly 6 digits");
  }
  if (typeof accountNumber !== "string" || !/^[0-9A-Za-z]{1,19}$/.test(accountNumber)) {
    throw new Error("accountNumber must contain 1 to 19 ASCII letters or digits");
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new Error("amount must be an integer from 1 to 99,999,999,999 VND");
  }
  if (typeof addInfo !== "string") {
    throw new Error("addInfo must be a string");
  }

  const note = addInfo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, 25);

  const recipient = tlv("00", bankBin) + tlv("01", accountNumber);
  const merchant = tlv("00", "A000000727") + tlv("01", recipient) + tlv("02", "QRIBFTTA");
  const payload = [
    tlv("00", "01"),
    tlv("01", "12"),
    tlv("38", merchant),
    tlv("53", "704"),
    tlv("54", String(amount)),
    tlv("58", "VN"),
    tlv("62", tlv("08", note)),
    "6304",
  ].join("");

  return payload + crc16ccitt(payload);
}

export async function vietQrPngDataUrl(input: VietQrInput): Promise<string> {
  return QRCode.toDataURL(buildVietQrPayload(input), pngOptions);
}

export async function vietQrPngBuffer(input: VietQrInput): Promise<Buffer> {
  return QRCode.toBuffer(buildVietQrPayload(input), pngOptions);
}
