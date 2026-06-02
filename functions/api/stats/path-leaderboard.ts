import { verifyAuth } from "../../_lib/auth";
import { assertUserAccess, ensureUser } from "../../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import { submitPathLeaderboardCandidate, type PathLeaderboardCandidate } from "../../_lib/pathLeaderboard";
import type { Env } from "../../_lib/types";

const normalizeCandidate = (value: unknown): PathLeaderboardCandidate => {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    simulationId: typeof body.simulationId === "string" ? body.simulationId : "",
    simulationUpdatedAt: typeof body.simulationUpdatedAt === "string" ? body.simulationUpdatedAt : "",
    fromSiteId: typeof body.fromSiteId === "string" ? body.fromSiteId : "",
    toSiteId: typeof body.toSiteId === "string" ? body.toSiteId : "",
    linkId: typeof body.linkId === "string" ? body.linkId : null,
    distanceKm: typeof body.distanceKm === "number" ? body.distanceKm : Number.NaN,
    rxAfterEnvLossDbm: typeof body.rxAfterEnvLossDbm === "number" ? body.rxAfterEnvLossDbm : Number.NaN,
    rxMarginDb: typeof body.rxMarginDb === "number" ? body.rxMarginDb : Number.NaN,
    terrainObstructed: body.terrainObstructed === true,
    terrainDataset: typeof body.terrainDataset === "string" ? body.terrainDataset : "",
    terrainTileSignature: typeof body.terrainTileSignature === "string" ? body.terrainTileSignature : "",
  };
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);

    const result = await submitPathLeaderboardCandidate(
      env,
      {
        id: me.id,
        isAdmin: me.isAdmin,
        isModerator: Boolean((me as { isModerator?: boolean }).isModerator),
      },
      normalizeCandidate(await request.json()),
    );

    return withCors(request, json(result, { status: result.ok ? 200 : 400 }));
  } catch (error) {
    return errorResponse(request, error, 400);
  }
};
