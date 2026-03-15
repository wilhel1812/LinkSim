import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, updateUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      console.info(JSON.stringify({ event: "me", result: "unauthorized_no_auth" }));
      return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const profile = await fetchUserProfile(env, auth.userId);
    if (!profile) {
      console.info(JSON.stringify({ event: "me", result: "user_not_found", userId: auth.userId }));
      return withCors(request, json({ error: "User not found" }, { status: 404 }));
    }
    console.info(
      JSON.stringify({
        event: "me",
        result: "ok",
        userId: auth.userId,
        accountState: profile.accountState,
        isApproved: profile.isApproved,
        isAdmin: profile.isAdmin,
        isModerator: profile.isModerator,
      }),
    );
    return withCors(
      request,
      json({
        user: profile,
      }),
    );
  } catch (error) {
    console.info(
      JSON.stringify({
        event: "me",
        result: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return errorResponse(request, error, 401);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const body = (await request.json()) as {
      username?: unknown;
      email?: unknown;
      bio?: unknown;
      accessRequestNote?: unknown;
      avatarUrl?: unknown;
      emailPublic?: unknown;
    };
    const user = await updateUserProfile(env, auth.userId, body);
    return withCors(request, json({ user }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
