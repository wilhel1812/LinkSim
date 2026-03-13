import { verifyAuth } from "../_lib/auth";
import { deriveUserRole } from "../_lib/access";
import { sendAccessGrantedEmail } from "../_lib/access-grant-email";
import { assertUserAccess, ensureUser, fetchUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const preferredEmail = typeof me.email === "string" && me.email.trim() ? me.email : me.idpEmail;
    const result = await sendAccessGrantedEmail(env, {
      userId: me.id,
      username: me.username,
      email: preferredEmail ?? "",
      role: deriveUserRole(me),
      approvedByUserId: me.id,
    });

    return withCors(request, json({ ok: true, result }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
