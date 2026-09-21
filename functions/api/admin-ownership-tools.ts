import { verifyAuth } from "../_lib/auth";
import {
  assertUserAccess,
  bulkReassignOwnership,
  ensureUser,
  fetchUserProfile,
  reassignResourceOwner,
} from "../_lib/db";
import { assistAuthIdentityRecovery, AuthAssistedRecoveryError } from "../_lib/authAssistedRecovery";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestPost: PagesFunction<Env> = async ({ request, env, data }) => {
  try {
    const auth = await verifyAuth(request, env, data);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const body = (await request.json()) as {
      action?: unknown;
      kind?: unknown;
      resourceId?: unknown;
      newOwnerUserId?: unknown;
      fromUserId?: unknown;
      toUserId?: unknown;
      authUserId?: unknown;
      linksimUserId?: unknown;
      evidenceType?: unknown;
      evidenceSummary?: unknown;
    };

    const action = typeof body.action === "string" ? body.action : "";
    if (action === "reassign_owner") {
      const kind = body.kind === "site" || body.kind === "simulation" ? body.kind : null;
      const resourceId = typeof body.resourceId === "string" ? body.resourceId.trim() : "";
      const newOwnerUserId = typeof body.newOwnerUserId === "string" ? body.newOwnerUserId.trim() : "";
      if (!kind || !resourceId || !newOwnerUserId) {
        return withCors(request, json({ error: "Missing ownership reassignment fields." }, { status: 400 }));
      }
      const result = await reassignResourceOwner(env, kind, resourceId, newOwnerUserId, auth.userId);
      return withCors(request, json({ ok: true, action, result }));
    }

    if (action === "bulk_reassign") {
      const fromUserId = typeof body.fromUserId === "string" ? body.fromUserId.trim() : "";
      const toUserId = typeof body.toUserId === "string" ? body.toUserId.trim() : "";
      if (!fromUserId || !toUserId) {
        return withCors(request, json({ error: "Missing bulk reassignment fields." }, { status: 400 }));
      }
      const result = await bulkReassignOwnership(env, fromUserId, toUserId, auth.userId);
      return withCors(request, json({ ok: true, action, result }));
    }

    if (action === "assist_auth_recovery") {
      if (env.AUTH_DUAL_LOGIN_MIGRATION_ENABLED !== "true") {
        return withCors(request, json({
          error: "Assisted account recovery is unavailable.",
          code: "RECOVERY_DISABLED",
        }, { status: 404 }));
      }
      const authUserId = typeof body.authUserId === "string" ? body.authUserId.trim() : "";
      const linksimUserId = typeof body.linksimUserId === "string" ? body.linksimUserId.trim() : "";
      const evidenceType = typeof body.evidenceType === "string" ? body.evidenceType.trim() : "";
      const evidenceSummary = typeof body.evidenceSummary === "string" ? body.evidenceSummary.trim() : "";
      if (!authUserId || !linksimUserId || !evidenceType || !evidenceSummary) {
        return withCors(request, json({
          error: "Assisted recovery requires the Better Auth user ID, LinkSim user ID, evidence type, and independent evidence summary.",
          code: "RECOVERY_EVIDENCE_REQUIRED",
        }, { status: 400 }));
      }
      try {
        const result = await assistAuthIdentityRecovery(env.DB, {
          actorUserId: auth.userId,
          authUserId,
          linksimUserId,
          evidenceType,
          evidenceSummary,
        });
        return withCors(request, json({ ok: true, action, result }));
      } catch (error) {
        if (error instanceof AuthAssistedRecoveryError) {
          const status = error.code === "ACTOR_FORBIDDEN"
            ? 403
            : error.code === "EVIDENCE_INSUFFICIENT"
              ? 400
              : error.code === "IDENTITY_CONFLICT"
                ? 409
                : 422;
          const message = error.code === "IDENTITY_CONFLICT"
            ? "The Better Auth or LinkSim identity is already connected. Nothing was changed."
            : error.code === "IDENTITY_INELIGIBLE"
              ? "One of the selected identities is not eligible for assisted recovery. Nothing was changed."
              : error.code === "EVIDENCE_INSUFFICIENT"
                ? "Record independent ownership evidence; an email address alone is insufficient."
                : "Assisted recovery could not be completed. Nothing was changed.";
          return withCors(request, json({ error: message, code: `RECOVERY_${error.code}` }, { status }));
        }
        throw error;
      }
    }

    return withCors(request, json({ error: "Unknown admin ownership action." }, { status: 400 }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
