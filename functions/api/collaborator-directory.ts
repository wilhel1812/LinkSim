import { verifyAuth } from "../_lib/auth";
import { assertUserAccess, ensureUser, listCollaboratorDirectory } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));

    await ensureUser(env, auth.userId, auth.tokenPayload);
    await assertUserAccess(env, auth.userId);

    const users = await listCollaboratorDirectory(env);
    return withCors(request, json({ users }));
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
