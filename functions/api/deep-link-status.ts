import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchUserProfile, resolveSimulationAccessForUser, resolveSimulationIdByOwnerSlug } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    let actor = { id: "", isAdmin: false, isModerator: false };
    let authenticated = false;
    let authState: "guest" | "authenticated" | "revoked" = "guest";
    if (auth) {
      await ensureUser(env, auth.userId, auth.tokenPayload);
      const me = await fetchUserProfile(env, auth.userId);
      if (me?.accountState === "revoked") {
        authState = "revoked";
      } else {
        authenticated = true;
        authState = "authenticated";
        actor = {
          id: me?.id ?? "",
          isAdmin: Boolean(me?.isAdmin),
          isModerator: Boolean((me as { isModerator?: boolean } | null)?.isModerator),
        };
      }
    }

    const url = new URL(request.url);
    const username = (url.searchParams.get("username") ?? "").trim();
    const simulationSlug = (url.searchParams.get("slug") ?? "").trim();
    let simulationId = (url.searchParams.get("sim") ?? "").trim();
    if (!simulationId && username && simulationSlug) {
      simulationId = (await resolveSimulationIdByOwnerSlug(env, username, simulationSlug)) ?? "";
    }
    if (!simulationId) {
      return withCors(request, json({ status: "missing", authenticated, authState }, { headers: NO_STORE_HEADERS }));
    }

    const status = await resolveSimulationAccessForUser(
      env,
      {
        id: actor.id,
        isAdmin: actor.isAdmin,
        isModerator: actor.isModerator,
      },
      simulationId,
    );

    return withCors(
      request,
      json({ status, simulationId, authenticated, authState }, { headers: NO_STORE_HEADERS }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
