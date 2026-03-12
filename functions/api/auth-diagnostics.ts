import { verifyAuth, inspectAuthRequest } from "../_lib/auth";
import { assertUserAccess, ensureUser, fetchUserProfile } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);
    const me = await fetchUserProfile(env, auth.userId);
    if (!me) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    if (!me.isAdmin) return withCors(request, json({ error: "Forbidden" }, { status: 403 }));

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
