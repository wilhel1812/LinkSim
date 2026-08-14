import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchLibraryForUser, upsertLibrarySnapshot } from "../_lib/db";
import type { LibraryReadPhase } from "../_lib/db";
import { ApiRequestError, errorResponse, handleOptions, json, readBoundedJson, withCors } from "../_lib/http";
import type { CloudResourceRecord, Env, LibrarySnapshotPayload } from "../_lib/types";
import {
  LIBRARY_JSON_MAX_DEPTH,
  LIBRARY_READ_CURSOR_MAX_CHARS,
  LIBRARY_READ_PAGE_MAX_RECORDS,
  LIBRARY_READ_RESPONSE_MAX_BYTES,
  LIBRARY_REQUEST_MAX_BYTES,
  validateLibraryPayload,
} from "../../src/lib/libraryLimits";

const phases = new Set<LibraryReadPhase>(["sites", "deleted_sites", "simulations", "deleted_simulations"]);
type ReadCursor = { v: 1; userId: string; since?: string; cutoff: string; phase: LibraryReadPhase; afterId: string };

const base64UrlEncode = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const base64UrlDecode = (value: string): unknown => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};

const validTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const decodeCursor = (encoded: string, userId: string): ReadCursor => {
  if (!encoded || encoded.length > LIBRARY_READ_CURSOR_MAX_CHARS) {
    throw new ApiRequestError("Library cursor is invalid.", 400, "invalid_cursor");
  }
  try {
    const value = base64UrlDecode(encoded) as Partial<ReadCursor>;
    if (value.v !== 1 || value.userId !== userId || !validTimestamp(value.cutoff)
      || (value.since !== undefined && !validTimestamp(value.since))
      || !phases.has(value.phase as LibraryReadPhase)
      || typeof value.afterId !== "string" || value.afterId.length > 128) {
      throw new Error("invalid");
    }
    return value as ReadCursor;
  } catch {
    throw new ApiRequestError("Library cursor is invalid.", 400, "invalid_cursor");
  }
};

const encodeCursor = (state: ReadCursor): string => {
  const encoded = base64UrlEncode(state);
  if (encoded.length > LIBRARY_READ_CURSOR_MAX_CHARS) {
    throw new ApiRequestError("Library cursor is too large.", 500, "cursor_too_large");
  }
  return encoded;
};

const responseBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const recordId = (value: unknown): string | undefined => value && typeof value === "object"
  && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined;

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const params = new URL(request.url).searchParams;
    const encodedCursor = params.get("cursor");
    const requestedSince = params.get("since") ?? undefined;
    if (requestedSince && !validTimestamp(requestedSince)) {
      throw new ApiRequestError("Library since timestamp is invalid.", 400, "invalid_since");
    }
    const paginationRequested = encodedCursor !== null || params.get("pagination") === "v1";
    if (!paginationRequested) {
      const library = await fetchLibraryForUser(env, auth.userId, { since: requestedSince });
      return withCors(
        request,
        json({
          userId: auth.userId,
          ...library,
          isDelta: Boolean(requestedSince),
        }),
      );
    }
    const state: ReadCursor = encodedCursor !== null
      ? decodeCursor(encodedCursor, auth.userId)
      : { v: 1, userId: auth.userId, ...(requestedSince ? { since: requestedSince } : {}), cutoff: new Date().toISOString(), phase: "sites", afterId: "" };
    const library = await fetchLibraryForUser(env, auth.userId, {
      since: state.since,
      cutoff: state.cutoff,
      phase: state.phase,
      afterId: state.afterId,
      limit: LIBRARY_READ_PAGE_MAX_RECORDS,
    });
    let pageCursor = library.nextCursor;
    const body = {
      userId: auth.userId,
      siteLibrary: [...(library.siteLibrary ?? [])],
      simulationPresets: [...(library.simulationPresets ?? [])],
      deletedSiteIds: [...(library.deletedSiteIds ?? [])],
      deletedSimulationIds: [...(library.deletedSimulationIds ?? [])],
      syncCutoff: state.cutoff,
      isDelta: Boolean(state.since),
      ...(pageCursor ? { nextCursor: encodeCursor({ ...state, ...pageCursor }) } : {}),
    };
    const phaseCollection = state.phase === "sites" ? body.siteLibrary
      : state.phase === "simulations" ? body.simulationPresets
        : state.phase === "deleted_sites" ? body.deletedSiteIds : body.deletedSimulationIds;
    const originalRecordCount = phaseCollection.length;
    while (responseBytes(body) > LIBRARY_READ_RESPONSE_MAX_BYTES && phaseCollection.length > 0) {
      phaseCollection.pop();
      const last = phaseCollection.at(-1);
      const afterId = typeof last === "string" ? last : recordId(last) ?? state.afterId;
      pageCursor = { phase: state.phase, afterId };
      body.nextCursor = encodeCursor({ ...state, ...pageCursor });
    }
    if (originalRecordCount > 0 && phaseCollection.length === 0) {
      throw new ApiRequestError("A Library record exceeds the response limit.", 500, "record_too_large");
    }
    if (responseBytes(body) > LIBRARY_READ_RESPONSE_MAX_BYTES) {
      throw new ApiRequestError("Library page exceeds the response limit.", 500, "response_too_large");
    }
    return withCors(
      request,
      json(body),
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
