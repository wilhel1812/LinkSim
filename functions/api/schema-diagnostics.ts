import { verifyAuth } from "../_lib/auth";
import { fetchUserDiagnosticAccessState, getSchemaDiagnostics } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    const me = await fetchUserDiagnosticAccessState(env, auth.userId);
    if (!me?.isAdmin || me.accountState === "revoked") {
      return withCors(request, json({ error: "Forbidden" }, { status: 403 }));
    }

    const diagnostics = await getSchemaDiagnostics(env);
    return withCors(request, json({ schema: diagnostics }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
