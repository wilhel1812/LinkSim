import { verifyAuth } from "../_lib/auth";
import {
  assertUserAccess,
  bulkReassignOwnership,
  ensureUser,
  fetchUserProfile,
  reassignResourceOwner,
} from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const body = (await request.json()) as {
      action?: unknown;
      kind?: unknown;
      resourceId?: unknown;
      newOwnerUserId?: unknown;
      fromUserId?: unknown;
      toUserId?: unknown;
    };

    const action = typeof body.action === "string" ? body.action : "";
    if (action === "reassign_owner") {
      const kind = body.kind === "site" || body.kind === "simulation" ? body.kind : null;
      const resourceId = typeof body.resourceId === "string" ? body.resourceId.trim() : "";
      const newOwnerUserId = typeof body.newOwnerUserId === "string" ? body.newOwnerUserId.trim() : "";
      if (!kind || !resourceId || !newOwnerUserId) {
        return withCors(request, json({ error: "Missing ownership reassignment fields." }, { status: 400 }));
      }
      const result = await reassignResourceOwner(env, kind, resourceId, newOwnerUserId, auth.userId);
      return withCors(request, json({ ok: true, action, result }));
    }

    if (action === "bulk_reassign") {
      const fromUserId = typeof body.fromUserId === "string" ? body.fromUserId.trim() : "";
      const toUserId = typeof body.toUserId === "string" ? body.toUserId.trim() : "";
      if (!fromUserId || !toUserId) {
        return withCors(request, json({ error: "Missing bulk reassignment fields." }, { status: 400 }));
      }
      const result = await bulkReassignOwnership(env, fromUserId, toUserId, auth.userId);
      return withCors(request, json({ ok: true, action, result }));
    }

    return withCors(request, json({ error: "Unknown admin ownership action." }, { status: 400 }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
