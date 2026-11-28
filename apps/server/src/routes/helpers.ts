import type { Seller } from "@livemate/shared";
import type { Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { AUTH_SESSION_TTL_MS, hashToken, parseCookies, SESSION_COOKIE_NAME } from "../auth/crypto.ts";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../store/errors.ts";
import type { AuthSessionRecord, BackendStore } from "../store/types.ts";

export interface AuthenticatedContext {
  seller: Seller;
  authSession: AuthSessionRecord;
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Dữ liệu không hợp lệ");
  }
  return result.data;
}

export async function resolveAuthenticatedSeller(
  req: Request,
  store: BackendStore,
): Promise<AuthenticatedContext | null> {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const resolved = await store.findAuthSessionByTokenHash(hashToken(rawToken));
  if (!resolved) return null;
  return { seller: resolved.seller, authSession: resolved.session };
}

export function isSecureRequest(req: Request): boolean {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return req.secure || forwardedProto === "https";
}

export function setSessionCookie(req: Request, res: Response, rawToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_SESSION_TTL_MS,
    secure: isSecureRequest(req),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureRequest(req),
  });
}

export function withSellerAuth(
  store: BackendStore,
  handler: (req: Request, res: Response, ctx: AuthenticatedContext) => unknown | Promise<unknown>,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const ctx = await resolveAuthenticatedSeller(req, store);
      if (!ctx) throw new UnauthorizedError("Vui lòng đăng nhập.");
      await handler(req, res, ctx);
    } catch (err) {
      next(err);
    }
  };
}

export async function requireOwnedSession(store: BackendStore, sessionId: string, sellerId: string) {
  const session = await store.getSessionById(sessionId);
  if (!session) throw new NotFoundError("Không tìm thấy phiên live");
  if (session.sellerId !== sellerId) {
    throw new ForbiddenError("Bạn không có quyền truy cập phiên live này");
  }
  return session;
}
