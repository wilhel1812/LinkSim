import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, updateUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const withoutInternalIdentity = <T extends Record<string, unknown>>(profile: T): Omit<T, "idpEmail" | "idpEmailVerified"> => {
  const ordinaryProfile = { ...profile };
  delete ordinaryProfile.idpEmail;
  delete ordinaryProfile.idpEmailVerified;
  return ordinaryProfile;
};

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
          user: withoutInternalIdentity(profile),
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
      simulationDefaultsPreference?: unknown;
    };
    const user = await updateUserProfile(env, auth.userId, body);
    return withCors(request, json({ user: withoutInternalIdentity(user) }, { headers: NO_STORE_HEADERS }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
