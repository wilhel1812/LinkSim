import { verifyAuth } from "../_lib/auth";
import { ensureUser, fetchLibraryForUser, upsertLibrarySnapshot } from "../_lib/db";
import { handleOptions, json, withCors } from "../_lib/http";
import type { CloudResourceRecord, Env, LibrarySnapshotPayload } from "../_lib/types";

const normalizeArray = (value: unknown): CloudResourceRecord[] => (Array.isArray(value) ? (value as CloudResourceRecord[]) : []);

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    const library = await fetchLibraryForUser(env, auth.userId);
    return withCors(
      request,
      json({
        userId: auth.userId,
        ...library,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withCors(request, json({ error: message }, { status: 500 }));
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);

    const body = (await request.json()) as LibrarySnapshotPayload;
    const siteLibrary = normalizeArray(body.siteLibrary);
    const simulationPresets = normalizeArray(body.simulationPresets);

    const result = await upsertLibrarySnapshot(env, auth.userId, {
      siteLibrary,
      simulationPresets,
    });

    return withCors(
      request,
      json({
        ok: true,
        ...result,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withCors(request, json({ error: message }, { status: 400 }));
  }
};
