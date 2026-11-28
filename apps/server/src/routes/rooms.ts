import express from "express";
import { z } from "zod";
import { NotFoundError } from "../store/errors.ts";
import { toPublicComment, toPublicSession } from "../store/transitions.ts";
import type { BackendStore } from "../store/types.ts";
import { parseBody } from "./helpers.ts";

const JoinRoomBody = z.object({
  displayName: z.string().trim().max(60).optional(),
  buyerToken: z.string().trim().min(1).optional(),
});

export function createRoomsRouter(deps: { store: BackendStore }): express.Router {
  const router = express.Router();
  const { store } = deps;

  router.get("/rooms/:roomCode", async (req, res, next) => {
    try {
      const roomCode = String(req.params.roomCode ?? "");
      const session = await store.getSessionByRoomCode(roomCode);
      if (!session) throw new NotFoundError("Không tìm thấy phòng live");

      const [featuredProduct, comments] = await Promise.all([
        session.featuredProductId ? store.getProductById(session.id, session.featuredProductId) : Promise.resolve(null),
        store.listComments(session.id),
      ]);

      res.json({
        session: toPublicSession(session),
        featuredProduct,
        comments: comments.map(toPublicComment),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/rooms/:roomCode/join", async (req, res, next) => {
    try {
      const roomCode = String(req.params.roomCode ?? "");
      const session = await store.getSessionByRoomCode(roomCode);
      if (!session) throw new NotFoundError("Không tìm thấy phòng live");

      const body = parseBody(JoinRoomBody, req.body ?? {});
      const { buyerToken, order } = await store.joinRoomAsBuyer(session.id, body);
      res.json({ buyerToken, order });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
