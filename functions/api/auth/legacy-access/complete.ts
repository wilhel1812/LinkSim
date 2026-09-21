import {
  LegacyAuthMigrationError,
  completeLegacyAuthMigrationAttempt,
} from "../../../_lib/authIdentityMap";
import { hasExactRequestOrigin } from "../../../_lib/apiRoutePolicy";
import { ApiRequestError, json, readBoundedJson } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";

const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

const failure = (status: number, code: string, error: string) =>
  json({ code, error }, { status, headers: NO_STORE });

const migrationFailure = (error: LegacyAuthMigrationError) => {
  if (error.code === "ATTEMPT_EXPIRED") {
    return failure(410, "MIGRATION_EXPIRED", "The migration attempt expired. Start again and complete both sign-ins within ten minutes.");
  }
  if (error.code === "ATTEMPT_CONSUMED") {
    return failure(409, "MIGRATION_CONFLICT", "This migration attempt is no longer available. Nothing was changed.");
  }
  if (error.code === "IDENTITY_CONFLICT" || error.code === "ATTEMPT_IDENTITY_MISMATCH") {
    return failure(409, "MIGRATION_CONFLICT", "One of these accounts is already connected differently. Nothing was changed.");
  }
  if (error.code === "LEGACY_IDENTITY_INELIGIBLE" || error.code === "AUTH_IDENTITY_INELIGIBLE") {
    return failure(409, "MIGRATION_INELIGIBLE", "The current account state requires administrator review. Nothing was changed.");
  }
  if (error.code === "ATTEMPT_NOT_FOUND") {
    return failure(404, "MIGRATION_INVALID", "The migration attempt was not found. Start account migration again.");
  }
  return failure(503, "MIGRATION_FAILED", "LinkSim could not finish account migration. Nothing was changed; try again.");
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.AUTH_DUAL_LOGIN_MIGRATION_ENABLED !== "true") {
    return failure(404, "MIGRATION_DISABLED", "Account migration is unavailable.");
  }
  if (!hasExactRequestOrigin(request)) {
    return failure(403, "MIGRATION_FORBIDDEN", "Account migration must be completed from this LinkSim page.");
  }
  let body: { attemptId?: unknown };
  try {
    body = await readBoundedJson(request, { maxBytes: 256, maxDepth: 2 });
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 400;
    return failure(status, "MIGRATION_INVALID", "The migration request is invalid. Start account migration again.");
  }
  const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
  if (!ATTEMPT_ID.test(attemptId)) {
    return failure(400, "MIGRATION_INVALID", "The migration request is invalid. Start account migration again.");
  }
  if (!env.AUTH) return failure(503, "MIGRATION_FAILED", "The authentication service is unavailable. Try again.");

  const sessionHeaders = new Headers();
  for (const name of ["cookie", "origin", "user-agent", "cf-connecting-ip"] as const) {
    const value = request.headers.get(name);
    if (value !== null) sessionHeaders.set(name, value);
  }
  let session;
  try {
    session = await env.AUTH.getByName("auth").checkSession(new Request(
      `${new URL(request.url).origin}/api/auth/get-session`,
      { method: "GET", headers: sessionHeaders },
    ));
  } catch {
    return failure(503, "MIGRATION_FAILED", "The authentication service is unavailable. Try again.");
  }
  if (session.status !== 200 || !session.authUserId || session.fresh !== true) {
    return failure(401, "MIGRATION_STALE", "GitHub sign-in is missing or no longer fresh. Start account migration again.");
  }

  try {
    const result = await completeLegacyAuthMigrationAttempt(env.DB, {
      attemptId,
      authUserId: session.authUserId,
    });
    return json({ ok: true, userId: result.linksimUserId }, { headers: NO_STORE });
  } catch (error) {
    return error instanceof LegacyAuthMigrationError
      ? migrationFailure(error)
      : failure(503, "MIGRATION_FAILED", "LinkSim could not finish account migration. Nothing was changed; try again.");
  }
};
