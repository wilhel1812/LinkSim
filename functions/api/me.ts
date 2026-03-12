import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, updateUserProfile } from "../_lib/db";
import { handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const profile = await fetchUserProfile(env, auth.userId);
    if (!profile) {
      return withCors(request, json({ error: "User not found" }, { status: 404 }));
    }
    return withCors(
      request,
      json({
        user: profile,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("removed by admin")
      ? 403
      : message.includes("pending approval")
        ? 403
        : 401;
    return withCors(request, json({ error: message }, { status }));
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
    };
    const user = await updateUserProfile(env, auth.userId, body);
    return withCors(request, json({ user }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.includes("removed by admin") || message.includes("pending approval")
        ? 403
        : message.includes("required") || message.includes("valid")
          ? 400
          : 500;
    return withCors(request, json({ error: message }, { status }));
  }
};
