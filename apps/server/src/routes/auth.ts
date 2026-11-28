import bcrypt from "bcryptjs";
import express from "express";
import { z } from "zod";
import {
  AUTH_SESSION_TTL_MS,
  generateToken,
  hashToken,
  parseCookies,
  SESSION_COOKIE_NAME,
  signSocketToken,
  SOCKET_TOKEN_TTL_MS,
} from "../auth/crypto.ts";
import { UnauthorizedError } from "../store/errors.ts";
import type { BackendStore } from "../store/types.ts";
import { clearSessionCookie, parseBody, setSessionCookie, withSellerAuth } from "./helpers.ts";

const RegisterBody = z.object({
  email: z.string().trim().email("Email không hợp lệ").max(200),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự").max(128),
  displayName: z.string().trim().min(1).max(80).optional(),
});

const LoginBody = z.object({
  email: z.string().trim().email("Email không hợp lệ").max(200),
  password: z.string().min(1, "Vui lòng nhập mật khẩu").max(128),
});

export function createAuthRouter(deps: {
  store: BackendStore;
  authSecret: string;
  onLogout?: (authSessionId: string) => void | Promise<void>;
}): express.Router {
  const router = express.Router();
  const { store, authSecret } = deps;

  router.post("/auth/register", async (req, res, next) => {
    try {
      const body = parseBody(RegisterBody, req.body ?? {});
      const email = body.email.toLowerCase();
      const displayName = body.displayName?.trim() || email.split("@")[0] || "Seller";
      const passwordHash = await bcrypt.hash(body.password, 10);
      const seller = await store.createSeller({ email, passwordHash, displayName });

      const rawToken = generateToken(32);
      const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
      await store.createAuthSession(seller.id, hashToken(rawToken), expiresAt);
      setSessionCookie(req, res, rawToken);

      res.status(201).json({ seller });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const body = parseBody(LoginBody, req.body ?? {});
      const sellerRecord = await store.findSellerByEmail(body.email);
      if (!sellerRecord) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");

      const ok = await bcrypt.compare(body.password, sellerRecord.passwordHash);
      if (!ok) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");

      const rawToken = generateToken(32);
      const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
      await store.createAuthSession(sellerRecord.id, hashToken(rawToken), expiresAt);
      setSessionCookie(req, res, rawToken);

      res.json({
        seller: {
          id: sellerRecord.id,
          email: sellerRecord.email,
          displayName: sellerRecord.displayName,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/logout", async (req, res, next) => {
    try {
      const rawToken = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (rawToken) {
        const tokenHash = hashToken(rawToken);
        const existing = await store.findAuthSessionByTokenHash(tokenHash);
        await store.deleteAuthSessionByTokenHash(tokenHash);
        if (existing) {
          await deps.onLogout?.(existing.session.id);
        }
      }
      clearSessionCookie(req, res);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/auth/me",
    withSellerAuth(store, (_req, res, { seller }) => {
      res.json({ seller });
    }),
  );

  router.get(
    "/auth/socket-token",
    withSellerAuth(store, (_req, res, { seller, authSession }) => {
      const token = signSocketToken(
        {
          sid: authSession.id,
          sellerId: seller.id,
          exp: Date.now() + SOCKET_TOKEN_TTL_MS,
        },
        authSecret,
      );
      res.json({ token });
    }),
  );

  return router;
}
