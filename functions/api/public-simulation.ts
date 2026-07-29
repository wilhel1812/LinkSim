import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchPublicSimulationBundle, fetchUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };

type PublicAuthState = "guest" | "authenticated" | "revoked";
type PublicActor = { id: string; isAdmin: boolean; isModerator: boolean };

const resolveAuth = async (
  request: Request,
  env: Env,
  strict: boolean,
): Promise<{ authenticated: boolean; authState: PublicAuthState; actor: PublicActor | null }> => {
  const auth = strict
    ? await verifyAuth(request, env)
    : await verifyAuth(request, env).catch(() => null);
  if (!auth) {
    return { authenticated: false, authState: "guest", actor: null };
  }

  await ensureUser(env, auth.userId, auth.tokenPayload);
  const profile = await fetchUserProfile(env, auth.userId);
  if (profile?.accountState === "revoked") {
    return { authenticated: false, authState: "revoked", actor: null };
  }

  return {
    authenticated: true,
    authState: "authenticated",
    actor: {
      id: profile?.id ?? auth.userId,
      isAdmin: Boolean(profile?.isAdmin),
      isModerator: Boolean(profile?.isModerator),
    },
  };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "auth") {
      const auth = await resolveAuth(request, env, true);
      return withCors(
        request,
        json(
          { authenticated: auth.authenticated, authState: auth.authState },
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

    const { actor } = await resolveAuth(request, env, false);

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
