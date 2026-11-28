import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, Order, ServerToClientEvents } from "@livemate/shared";
import { api } from "./api";

export type LiveMateSocket<OrderPayload = Order> = Socket<ServerToClientEvents<OrderPayload>, ClientToServerEvents>;

export type SocketAuthCallback = (cb: (data: { token?: string }) => void) => void;

export interface CreateLiveMateSocketOptions {
  /** Lấy fresh cookie-auth socket-token mỗi lần kết nối / kết nối lại. */
  withSellerAuth?: boolean;
  /** Callback auth tùy chỉnh cho namespace connection/reconnect. */
  auth?: SocketAuthCallback;
}

export function getSocketServerUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SERVER_URL) {
    return process.env.NEXT_PUBLIC_SERVER_URL.replace(/\/+$/, "");
  }
  return "http://localhost:4000";
}

export function createLiveMateSocket<OrderPayload = Order>(options?: CreateLiveMateSocketOptions): LiveMateSocket<OrderPayload> {
  const authCallback: SocketAuthCallback | undefined =
    options?.auth ??
    (options?.withSellerAuth
      ? (cb) => {
          api.auth
            .socketToken()
            .then(({ token }) => cb({ token }))
            .catch(() => cb({}));
        }
      : undefined);

  return io(getSocketServerUrl(), {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    ...(authCallback ? { auth: authCallback } : {}),
  });
}
