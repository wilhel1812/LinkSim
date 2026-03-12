import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, getSchemaDiagnostics } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const isBootstrapAdmin = (env: Env, userId: string): boolean =>
  (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(userId.toLowerCase());

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    let allowed = isBootstrapAdmin(env, auth.userId);
    try {
      await ensureUser(env, auth.userId, auth.tokenPayload);
      const me = await fetchUserProfile(env, auth.userId);
      if (me?.isAdmin) allowed = true;
    } catch {
      // If schema is out of date, allow bootstrap admins to inspect diagnostics.
    }
    if (!allowed) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const diagnostics = await getSchemaDiagnostics(env);
    return withCors(request, json({ schema: diagnostics }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
