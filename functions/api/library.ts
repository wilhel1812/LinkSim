import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchLibraryForUser, upsertLibrarySnapshot } from "../_lib/db";
import { errorResponse, handleOptions, json, readBoundedJson, withCors } from "../_lib/http";
import type { CloudResourceRecord, Env, LibrarySnapshotPayload } from "../_lib/types";
import {
  LIBRARY_JSON_MAX_DEPTH,
  LIBRARY_REQUEST_MAX_BYTES,
  validateLibraryPayload,
} from "../../src/lib/libraryLimits";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const since = new URL(request.url).searchParams.get("since") ?? undefined;
    const library = await fetchLibraryForUser(env, auth.userId, { since });
    return withCors(
      request,
      json({
        userId: auth.userId,
        ...library,
        isDelta: !!since,
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const me = await assertUserAccess(env, auth.userId);

    const body = await readBoundedJson<LibrarySnapshotPayload>(request, {
      maxBytes: LIBRARY_REQUEST_MAX_BYTES,
      maxDepth: LIBRARY_JSON_MAX_DEPTH,
    });
    const validated = validateLibraryPayload(body);
    const siteLibrary = validated.siteLibrary as CloudResourceRecord[];
    const simulationPresets = validated.simulationPresets as CloudResourceRecord[];

    const result = await upsertLibrarySnapshot(
      env,
      {
        id: me.id,
        isAdmin: me.isAdmin,
        isModerator: Boolean((me as { isModerator?: boolean }).isModerator),
      },
      {
      siteLibrary,
      simulationPresets,
      },
    );

    return withCors(
      request,
      json({
        ok: true,
        ...result,
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 400);
  }
};
