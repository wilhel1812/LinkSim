import { verifyAuth } from "../../../_lib/auth";
import { assertUserAccess, ensureUser, setSimulationLifecycleStatus } from "../../../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const actorPolicy = (user: { id: string; isAdmin: boolean; isModerator?: boolean }) => ({
  id: user.id,
  isAdmin: user.isAdmin,
  isModerator: Boolean(user.isModerator),
});

const lifecycleResponse = (request: Request, result: Awaited<ReturnType<typeof setSimulationLifecycleStatus>>) => {
  if (result.ok) return withCors(request, json(result));
  if (result.reason === "missing") return withCors(request, json({ error: "Simulation not found" }, { status: 404 }));
  return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);
    const simulationId = typeof params.id === "string" ? params.id.trim() : "";
    if (!simulationId) return withCors(request, json({ error: "Missing simulation id" }, { status: 400 }));
    return lifecycleResponse(request, await setSimulationLifecycleStatus(env, actorPolicy(me), simulationId, "deleted"));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
    const simulationId = typeof params.id === "string" ? params.id.trim() : "";
    if (!simulationId) return withCors(request, json({ error: "Missing simulation id" }, { status: 400 }));
    const body = (await request.json()) as { status?: unknown };
    if (body.status !== "active") return withCors(request, json({ error: "Invalid Simulation status" }, { status: 400 }));
    return lifecycleResponse(request, await setSimulationLifecycleStatus(env, actorPolicy(me), simulationId, "active"));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
