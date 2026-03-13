import { verifyAuth } from "../../_lib/auth";
import {
  canDeleteUserAccount,
  canAssignRole,
  canSetPendingOrUser,
  deriveAccountState,
  deriveUserRole,
} from "../../_lib/access";
import { sendAccessGrantedEmail } from "../../_lib/access-grant-email";
import {
  assertUserAccess,
  deleteUser,
  ensureUser,
  fetchUserProfile,
  setUserRole,
  setUserApproval,
  updateUserProfile,
} from "../../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env, UserRole } from "../../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    const targetId = typeof params.id === "string" ? params.id : "";
    if (!targetId) return withCors(request, json({ error: "Missing user id" }, { status: 400 }));
    const user = await fetchUserProfile(env, targetId);
    if (!user) return withCors(request, json({ error: "User not found" }, { status: 404 }));

    if (!me.isAdmin && !("isModerator" in me && Boolean((me as { isModerator?: boolean }).isModerator)) && me.id !== targetId) {
      const canSeeEmail = user.emailPublic;
      return withCors(
        request,
        json(
          {
            user: {
              id: user.id,
              username: user.username,
              bio: user.bio,
              avatarUrl: user.avatarUrl,
              ...(canSeeEmail ? { email: user.email } : {}),
              isAdmin: user.isAdmin,
              isModerator: (user as { isModerator?: boolean }).isModerator ?? false,
              isApproved: user.isApproved,
              role: (user as { role?: UserRole }).role ?? deriveUserRole(user),
              emailPublic: user.emailPublic,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            },
          },
          { status: 200 },
        ),
      );
    }
    return withCors(request, json({ user }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin && !("isModerator" in me && Boolean((me as { isModerator?: boolean }).isModerator))) {
      return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
    }

    const targetId = typeof params.id === "string" ? params.id : "";
    if (!targetId) return withCors(request, json({ error: "Missing user id" }, { status: 400 }));

    const body = (await request.json()) as {
      username?: unknown;
      email?: unknown;
      bio?: unknown;
      accessRequestNote?: unknown;
      avatarUrl?: unknown;
      emailPublic?: unknown;
      role?: unknown;
      isApproved?: unknown;
    };

    let user = await fetchUserProfile(env, targetId);
    if (!user) {
      await ensureUser(env, targetId);
      user = await fetchUserProfile(env, targetId);
    }
    if (!user) return withCors(request, json({ error: "User not found" }, { status: 404 }));
    const initialAccountState = deriveAccountState(user);

    if (
      body.username !== undefined ||
      body.email !== undefined ||
      body.bio !== undefined ||
      body.accessRequestNote !== undefined ||
      body.avatarUrl !== undefined
    ) {
      if (!me.isAdmin && targetId !== auth.userId) {
        return withCors(request, json({ error: "Only admins can edit another user's profile fields." }, { status: 403 }));
      }
      user = await updateUserProfile(env, targetId, {
        username: body.username,
        email: body.email,
        bio: body.bio,
        accessRequestNote: body.accessRequestNote,
        avatarUrl: body.avatarUrl,
        emailPublic: body.emailPublic,
      });
    }
    if (body.role !== undefined) {
      const nextRole = typeof body.role === "string" ? (body.role.trim().toLowerCase() as UserRole) : null;
      if (!nextRole || !["admin", "moderator", "user", "pending"].includes(nextRole)) {
        return withCors(request, json({ error: "Invalid role." }, { status: 400 }));
      }
      if (!canAssignRole(me, user, nextRole)) {
        return withCors(
          request,
          json({ error: "You cannot assign this role for the selected user." }, { status: 403 }),
        );
      }
      user = await setUserRole(env, targetId, nextRole, auth.userId);
    }
    if (body.isApproved !== undefined) {
      if (!canSetPendingOrUser(me, user)) {
        return withCors(request, json({ error: "You cannot change approval for this user." }, { status: 403 }));
      }
      user = await setUserApproval(env, targetId, body.isApproved, auth.userId);
    }

    const finalAccountState = deriveAccountState(user);
    const finalRole = deriveUserRole(user);
    if (initialAccountState === "pending" && finalAccountState === "approved") {
      const preferredEmail = typeof user.email === "string" && user.email.trim() ? user.email : user.idpEmail;
      const emailResult = await sendAccessGrantedEmail(env, {
        userId: user.id,
        username: user.username,
        email: preferredEmail ?? "",
        role: finalRole,
        approvedByUserId: auth.userId,
      });
      if (!emailResult.sent && emailResult.reason) {
        console.warn(`[users/${targetId}] access grant email skipped/failed: ${emailResult.reason}`);
      }
    }

    return withCors(request, json({ user }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const targetId = typeof params.id === "string" ? params.id : "";
    if (!targetId) return withCors(request, json({ error: "Missing user id" }, { status: 400 }));
    if (!canDeleteUserAccount(me, targetId)) {
      return withCors(request, json({ error: "Admin cannot delete own account." }, { status: 400 }));
    }

    await deleteUser(env, targetId, auth.userId);
    return withCors(request, json({ ok: true }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
