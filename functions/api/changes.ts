import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchResourceChanges, revertResourceFromChangeCopy } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);

    const url = new URL(request.url);
    const kindRaw = url.searchParams.get("kind");
    const resourceId = (url.searchParams.get("id") ?? "").trim();
    const kind = kindRaw === "site" || kindRaw === "simulation" ? kindRaw : null;

    if (!kind || !resourceId) {
      return withCors(request, json({ error: "Missing kind or id" }, { status: 400 }));
    }

    const result = await fetchResourceChanges(env, kind, resourceId, {
      id: me.id,
      isAdmin: me.isAdmin,
      isModerator: Boolean((me as { isModerator?: boolean }).isModerator),
    });
    if (!result.ok) {
      const missing = result.reason === "missing";
      return withCors(request, json(
        { error: missing ? "Resource not found" : "Forbidden" },
        { status: missing ? 404 : 403 },
      ));
    }
    return withCors(request, json({ changes: result.changes }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);

    const body = (await request.json()) as { kind?: unknown; id?: unknown; changeId?: unknown };
    const kind = body.kind === "site" || body.kind === "simulation" ? body.kind : null;
    const resourceId = typeof body.id === "string" ? body.id.trim() : "";
    const changeId = typeof body.changeId === "number" ? body.changeId : Number(body.changeId);
    if (!kind || !resourceId || !Number.isFinite(changeId)) {
      return withCors(request, json({ error: "Missing kind, id, or changeId" }, { status: 400 }));
    }

    const result = await revertResourceFromChangeCopy(env, kind, resourceId, Number(changeId), {
      id: me.id,
      isAdmin: me.isAdmin,
      isModerator: Boolean((me as { isModerator?: boolean }).isModerator),
    });
    if (!result.ok) {
      const missing = result.reason === "missing";
      return withCors(request, json(
        { error: missing ? "Resource not found" : result.reason ?? "Revert failed" },
        { status: missing ? 404 : 403 },
      ));
    }
    return withCors(request, json({ ok: true }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
