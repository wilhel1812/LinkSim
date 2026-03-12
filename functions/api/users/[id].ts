import { verifyAuth } from "../../_lib/auth";
import { ensureUser, fetchUserProfile, setUserAdminFlag, updateOwnUsername } from "../../_lib/db";
import { handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const targetId = typeof params.id === "string" ? params.id : "";
    if (!targetId) return withCors(request, json({ error: "Missing user id" }, { status: 400 }));

    const body = (await request.json()) as { username?: unknown; isAdmin?: unknown };

    let user = await fetchUserProfile(env, targetId);
    if (!user) {
      await ensureUser(env, targetId);
      user = await fetchUserProfile(env, targetId);
    }
    if (!user) return withCors(request, json({ error: "User not found" }, { status: 404 }));

    if (body.username !== undefined) {
      user = await updateOwnUsername(env, targetId, body.username);
    }
    if (body.isAdmin !== undefined) {
      user = await setUserAdminFlag(env, targetId, body.isAdmin);
    }

    return withCors(request, json({ user }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("between 2 and 48") ? 400 : 500;
    return withCors(request, json({ error: message }, { status }));
  }
};
