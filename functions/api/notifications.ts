import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchUserProfile, listPendingApprovalUsers } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);

    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    if (!me.isAdmin) {
      return withCors(request, json({ unreadCount: 0, items: [] }));
    }

    const pending = await listPendingApprovalUsers(env);
    const item = pending.length
      ? {
          id: "pending-user-approvals",
          type: "pending_users",
          severity: "warning",
          title: `Pending approvals (${pending.length})`,
          message: `${pending.length} user(s) waiting for admin review.`,
          createdAt: new Date().toISOString(),
          meta: { pendingUsers: pending },
        }
      : null;

    return withCors(
      request,
      json({
        unreadCount: pending.length,
        items: item ? [item] : [],
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
