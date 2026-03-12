import { verifyAuth } from "../../_lib/auth";
import {
  canDeleteUserAccount,
  canUpdateUserApproval,
  canUpdateUserRole,
} from "../../_lib/access";
import {
  assertUserAccess,
  deleteUser,
  ensureUser,
  fetchUserProfile,
  setUserAdminFlag,
  setUserApproval,
  updateUserProfile,
} from "../../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

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

    if (!me.isAdmin && me.id !== targetId) {
      return withCors(
        request,
        json(
          {
            user: {
              id: user.id,
              username: user.username,
              bio: user.bio,
              avatarUrl: user.avatarUrl,
              isAdmin: user.isAdmin,
              isApproved: user.isApproved,
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
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const targetId = typeof params.id === "string" ? params.id : "";
    if (!targetId) return withCors(request, json({ error: "Missing user id" }, { status: 400 }));

    const body = (await request.json()) as {
      username?: unknown;
      email?: unknown;
      bio?: unknown;
      accessRequestNote?: unknown;
      avatarUrl?: unknown;
      isAdmin?: unknown;
      isApproved?: unknown;
    };

    let user = await fetchUserProfile(env, targetId);
    if (!user) {
      await ensureUser(env, targetId);
      user = await fetchUserProfile(env, targetId);
    }
    if (!user) return withCors(request, json({ error: "User not found" }, { status: 404 }));

    if (
      body.username !== undefined ||
      body.email !== undefined ||
      body.bio !== undefined ||
      body.accessRequestNote !== undefined ||
      body.avatarUrl !== undefined
    ) {
      user = await updateUserProfile(env, targetId, {
        username: body.username,
        email: body.email,
        bio: body.bio,
        accessRequestNote: body.accessRequestNote,
        avatarUrl: body.avatarUrl,
      });
    }
    if (body.isAdmin !== undefined) {
      if (!canUpdateUserRole(me, targetId)) {
        return withCors(request, json({ error: "Users cannot change their own admin role." }, { status: 400 }));
      }
      user = await setUserAdminFlag(env, targetId, body.isAdmin);
    }
    if (body.isApproved !== undefined) {
      if (!canUpdateUserApproval(me, targetId)) {
        return withCors(request, json({ error: "Users cannot change their own approval state." }, { status: 400 }));
      }
      user = await setUserApproval(env, targetId, body.isApproved, auth.userId);
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
