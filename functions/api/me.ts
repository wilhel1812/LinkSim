import { verifyAuth } from "../_lib/auth";
import { ensureUser } from "../_lib/db";
import { handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const auth = await verifyAuth(request, env);
    if (!auth) {
      return withCors(request, json({ error: "Unauthorized" }, { status: 401 }));
    }
    await ensureUser(env, auth.userId);
    return withCors(
      request,
      json({
        userId: auth.userId,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withCors(request, json({ error: `Auth verification failed: ${message}` }, { status: 401 }));
  }
};
