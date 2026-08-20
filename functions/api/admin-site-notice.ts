import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchUserProfile } from "../_lib/db";
import { clearSiteNotice, publishSiteNotice, readSiteNotice } from "../_lib/siteNotice";
import { errorResponse, handleOptions, json, readBoundedJson, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";
import type { SiteNoticeDraft } from "../../src/lib/siteNotice";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const requireAdmin = async (request: Request, env: Env): Promise<string | Response> => {
  const auth = await verifyAuth(request, env);
  if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
  await ensureUser(env, auth.userId, auth.tokenPayload);
  await assertUserAccess(env, auth.userId);
  const me = await fetchUserProfile(env, auth.userId);
  if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
  if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
  return auth.userId;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const actor = await requireAdmin(request, env);
    if (actor instanceof Response) return actor;
    const notice = await readSiteNotice(env);
    return withCors(request, json({ notice }, { headers: { "cache-control": "no-store" } }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const actorId = await requireAdmin(request, env);
    if (actorId instanceof Response) return actorId;
    const draft = await readBoundedJson<SiteNoticeDraft>(request, { maxBytes: 4096, maxDepth: 3 });
    const notice = await publishSiteNotice(env, draft, { actorId, source: "admin-panel" });
    return withCors(request, json({ notice }, { headers: { "cache-control": "no-store" } }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const actorId = await requireAdmin(request, env);
    if (actorId instanceof Response) return actorId;
    await clearSiteNotice(env, { actorId, source: "admin-panel" });
    return withCors(request, json({ notice: null }, { headers: { "cache-control": "no-store" } }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
