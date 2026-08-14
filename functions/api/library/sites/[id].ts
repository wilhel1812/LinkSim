import { verifyAuth } from "../../../_lib/auth";
import { assertUserAccess, deleteSiteResource, ensureUser } from "../../../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);
    const siteId = typeof params.id === "string" ? params.id.trim() : "";
    if (!siteId) return withCors(request, json({ error: "Missing Site id" }, { status: 400 }));
    const result = await deleteSiteResource(
      env,
      { id: me.id, isAdmin: me.isAdmin, isModerator: Boolean(me.isModerator) },
      siteId,
    );
    if (result.ok) return withCors(request, json(result));
    if (result.reason === "missing") return withCors(request, json({ ok: true, siteId, alreadyDeleted: true }));
    return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
