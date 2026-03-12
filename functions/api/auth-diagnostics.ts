import { verifyAuth, inspectAuthRequest } from "../_lib/auth";
import { ensureUser, fetchUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const isBootstrapAdmin = (env: Env, userId: string): boolean =>
  (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(userId.toLowerCase());

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    let allowed = isBootstrapAdmin(env, auth.userId);
    try {
      await ensureUser(env, auth.userId, auth.tokenPayload);
      const me = await fetchUserProfile(env, auth.userId);
      if (me?.isAdmin) allowed = true;
    } catch {
      // If schema is out of date, allow bootstrap admins to inspect diagnostics.
    }
    if (!allowed) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

    const claims = auth.tokenPayload;
    return withCors(
      request,
      json({
        auth: {
          source: auth.source ?? "unknown",
          userId: auth.userId,
          signals: inspectAuthRequest(request),
          claims: {
            iss: typeof claims.iss === "string" ? claims.iss : null,
            sub: typeof claims.sub === "string" ? claims.sub : null,
            email: typeof claims.email === "string" ? claims.email : null,
            name: typeof claims.name === "string" ? claims.name : null,
            iat: typeof claims.iat === "number" ? claims.iat : null,
            exp: typeof claims.exp === "number" ? claims.exp : null,
          },
          config: {
            accessAudConfigured: Boolean((env.ACCESS_AUD ?? "").trim()),
            accessTeamDomainConfigured: Boolean((env.ACCESS_TEAM_DOMAIN ?? "").trim()),
            insecureDevAuthEnabled: (env.ALLOW_INSECURE_DEV_AUTH ?? "").trim().toLowerCase() === "true",
            authObservabilityEnabled: (env.AUTH_OBSERVABILITY ?? "true").trim().toLowerCase() !== "false",
          },
        },
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
