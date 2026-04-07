import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, updateUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const profile = await fetchUserProfile(env, auth.userId);
    if (!profile) {
      return withCors(request, json({ error: "User not found" }, { status: 404, headers: NO_STORE_HEADERS }));
    }
    return withCors(
      request,
      json(
        {
          user: profile,
        },
        { headers: NO_STORE_HEADERS },
      ),
    );
  } catch (error) {
    return errorResponse(request, error, 401);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS }));
    }
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const body = (await request.json()) as {
      username?: unknown;
      email?: unknown;
      bio?: unknown;
      accessRequestNote?: unknown;
      avatarUrl?: unknown;
      emailPublic?: unknown;
      defaultFrequencyPresetId?: unknown;
    };
    const user = await updateUserProfile(env, auth.userId, body);
    return withCors(request, json({ user }, { headers: NO_STORE_HEADERS }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
