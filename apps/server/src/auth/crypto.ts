import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "livemate_session";
export const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const SOCKET_TOKEN_TTL_MS = 2 * 60_000;

export interface SocketTokenPayload {
  sid: string;
  sellerId: string;
  exp: number;
}

export function generateToken(byteLength = 24): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function redactBuyerId(sessionId: string, buyerExternalId: string): string {
  const digest = createHash("sha256").update(`${sessionId}:${buyerExternalId}`).digest("hex").slice(0, 12);
  return `anon_${digest}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

export function signSocketToken(payload: SocketTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, purpose: "socket" }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySocketToken(token: string, secret: string, now = Date.now()): SocketTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sid?: unknown;
      sellerId?: unknown;
      exp?: unknown;
      purpose?: unknown;
    };
    if (
      parsed.purpose !== "socket" ||
      typeof parsed.sid !== "string" ||
      !parsed.sid ||
      typeof parsed.sellerId !== "string" ||
      !parsed.sellerId ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= now
    ) {
      return null;
    }
    return { sid: parsed.sid, sellerId: parsed.sellerId, exp: parsed.exp };
  } catch {
    return null;
  }
}
