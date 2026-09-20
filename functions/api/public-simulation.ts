import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchPublicSimulationBundle, fetchUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, isRevokedAuthError, json, withCors } from "../_lib/http";
import type { AuthRequestData, Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };

type PublicAuthState = "guest" | "authenticated" | "revoked";
type PublicAuthSource = "access" | "better-auth" | "dev" | null;
type PublicActor = { id: string; isAdmin: boolean; isModerator: boolean };

const publicAuthSource = (source: string | undefined): Exclude<PublicAuthSource, null> =>
  source === "better-auth" ? "better-auth" : source === "dev" ? "dev" : "access";

const resolveAuth = async (
  request: Request,
  env: Env,
  strict: boolean,
  data: AuthRequestData,
): Promise<{
  authenticated: boolean;
  authState: PublicAuthState;
  authSource: PublicAuthSource;
  actor: PublicActor | null;
}> => {
  const auth = strict
    ? await verifyAuth(request, env, data)
    : await verifyAuth(request, env, data).catch(() => null);
  if (!auth) {
    return { authenticated: false, authState: "guest", authSource: null, actor: null };
  }
  const authSource = publicAuthSource(auth.source);

  try {
    await ensureUser(env, auth.userId, auth.tokenPayload);
  } catch (error) {
    if (isRevokedAuthError(error)) {
      return { authenticated: false, authState: "revoked", authSource, actor: null };
    }
    throw error;
  }
  const profile = await fetchUserProfile(env, auth.userId);
  if (profile?.accountState === "revoked") {
    return { authenticated: false, authState: "revoked", authSource, actor: null };
  }

  return {
    authenticated: true,
    authState: "authenticated",
    authSource,
    actor: {
      id: profile?.id ?? auth.userId,
      isAdmin: Boolean(profile?.isAdmin),
      isModerator: Boolean(profile?.isModerator),
    },
  };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, data }) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "auth") {
      const auth = await resolveAuth(request, env, true, data);
      return withCors(
        request,
        json(
          { authenticated: auth.authenticated, authState: auth.authState, authSource: auth.authSource },
          { headers: NO_STORE_HEADERS },
        ),
      );
    }

    const simulationId = (url.searchParams.get("sim") ?? "").trim();
    const username = (url.searchParams.get("username") ?? "").trim();
    const simulationSlug = (url.searchParams.get("slug") ?? "").trim();
    if (!simulationId && (!username || !simulationSlug)) {
      return withCors(request, json({ error: "Missing simulation id or username-scoped slug" }, { status: 400, headers: NO_STORE_HEADERS }));
    }

    const { actor } = await resolveAuth(request, env, false, data);

    const bundle = await fetchPublicSimulationBundle(env, {
      simulationId: simulationId || undefined,
      username: username || undefined,
      simulationSlug: simulationSlug || undefined,
      actor,
    });

    if (bundle.status !== "ok") {
      if (bundle.status === "missing") {
        return withCors(request, json({ status: "missing" }, { status: 404, headers: NO_STORE_HEADERS }));
      }
      return withCors(request, json({ status: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS }));
    }

    return withCors(
      request,
      json(
        {
          status: "ok",
          simulationId: bundle.simulationId,
          siteLibrary: bundle.sites,
          simulationPresets: [bundle.simulation],
        },
        { headers: NO_STORE_HEADERS },
      ),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
