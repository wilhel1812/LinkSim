import { verifyAuth } from "../_lib/auth";
import { fetchPublicSimulationBundle } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const simulationId = (url.searchParams.get("sim") ?? "").trim();
    const username = (url.searchParams.get("username") ?? "").trim();
    const simulationSlug = (url.searchParams.get("slug") ?? "").trim();
    if (!simulationId && (!username || !simulationSlug)) {
      return withCors(request, json({ error: "Missing simulation id or username-scoped slug" }, { status: 400, headers: NO_STORE_HEADERS }));
    }

    const auth = await verifyAuth(request, env).catch(() => null);
    const actorId = auth?.userId ?? null;

    const bundle = await fetchPublicSimulationBundle(env, {
      simulationId: simulationId || undefined,
      username: username || undefined,
      simulationSlug: simulationSlug || undefined,
      actorId,
    });

    if (bundle.status !== "ok") {
      if (bundle.status === "missing") {
        return withCors(request, json({ status: "missing" }, { status: 404, headers: NO_STORE_HEADERS }));
      }
      return withCors(request, json({ status: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS }));
    }

    return withCors(
      request,
      json(
        {
          status: "ok",
          simulationId: bundle.simulationId,
          siteLibrary: bundle.sites,
          simulationPresets: [bundle.simulation],
        },
        { headers: NO_STORE_HEADERS },
      ),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
