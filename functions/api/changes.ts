import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchResourceChanges } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);

    const url = new URL(request.url);
    const kindRaw = url.searchParams.get("kind");
    const resourceId = (url.searchParams.get("id") ?? "").trim();
    const kind = kindRaw === "site" || kindRaw === "simulation" ? kindRaw : null;

    if (!kind || !resourceId) {
      return withCors(request, json({ error: "Missing kind or id" }, { status: 400 }));
    }

    const changes = await fetchResourceChanges(env, kind, resourceId);
    return withCors(request, json({ changes }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
