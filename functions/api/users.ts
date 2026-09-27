import { verifyAuth } from "../_lib/auth";
import { canListUsers } from "../_lib/access";
import {
  assertUserAccess,
  authMigrationSchemaAvailable,
  ensureUser,
  fetchUserProfile,
  getAuthMigrationProgress,
  listUsers,
} from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env, data }) => {
  try {
    const auth = await verifyAuth(request, env, data);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!canListUsers(me)) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const includeAuthMigration = me.isAdmin && await authMigrationSchemaAvailable(env.DB);
    const [users, authMigrationProgress] = includeAuthMigration
      ? await Promise.all([
        listUsers(env, true, true),
        getAuthMigrationProgress(env.DB),
      ])
      : [await listUsers(env, me.isAdmin, false), null];
    return withCors(request, json({
      users,
      ...(me.isAdmin ? { authMigrationAggregateAvailable: includeAuthMigration } : {}),
      ...(authMigrationProgress ? { authMigrationProgress } : {}),
    }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
