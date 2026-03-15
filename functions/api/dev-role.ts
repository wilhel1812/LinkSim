import { verifyAuth } from "../_lib/auth";
import { ensureUser, setUserRole } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env, UserRole } from "../_lib/types";

const isDevAuthEnabled = (env: Env): boolean => (env.ALLOW_INSECURE_DEV_AUTH ?? "").trim().toLowerCase() === "true";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!isDevAuthEnabled(env)) {
      return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
    }

    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);

    const body = (await request.json()) as { role?: unknown };
    const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
    const nextRole: UserRole | null =
      role === "admin" || role === "moderator" || role === "user" || role === "pending"
        ? (role as UserRole)
        : null;
    if (!nextRole) {
      return withCors(request, json({ error: "Invalid role" }, { status: 400 }));
    }

    const user = await setUserRole(env, auth.userId, nextRole, auth.userId);
    return withCors(request, json({ ok: true, user }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
