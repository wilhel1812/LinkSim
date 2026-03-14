import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, resolveSimulationAccessForUser } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);

    const url = new URL(request.url);
    const simulationId = (url.searchParams.get("sim") ?? "").trim();
    if (!simulationId) {
      return withCors(request, json({ error: "Missing simulation id" }, { status: 400 }));
    }

    const status = await resolveSimulationAccessForUser(
      env,
      {
        id: me.id,
        isAdmin: me.isAdmin,
        isModerator: Boolean((me as { isModerator?: boolean }).isModerator),
      },
      simulationId,
    );

    return withCors(request, json({ status }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
