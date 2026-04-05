import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchLibraryForUser, upsertLibrarySnapshot } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { CloudResourceRecord, Env, LibrarySnapshotPayload } from "../_lib/types";

const normalizeArray = (value: unknown): CloudResourceRecord[] => (Array.isArray(value) ? (value as CloudResourceRecord[]) : []);

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

    const body = (await request.json()) as LibrarySnapshotPayload;
    const siteLibrary = normalizeArray(body.siteLibrary);
    const simulationPresets = normalizeArray(body.simulationPresets);

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
