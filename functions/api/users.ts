import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, listUsers } from "../_lib/db";
import { handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const users = await listUsers(env);
    return withCors(request, json({ users }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withCors(request, json({ error: message }, { status: 500 }));
  }
};
