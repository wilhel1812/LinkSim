import { fetchPublicSimulationBundle } from "../_lib/db";
import { errorResponse, handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const simulationId = (url.searchParams.get("sim") ?? "").trim();
    const simulationSlug = (url.searchParams.get("slug") ?? "").trim();
    if (!simulationId && !simulationSlug) {
      return withCors(request, json({ error: "Missing simulation id or slug" }, { status: 400 }));
    }

    const bundle = await fetchPublicSimulationBundle(env, {
      simulationId: simulationId || undefined,
      simulationSlug: simulationSlug || undefined,
    });

    if (bundle.status === "missing") {
      return withCors(request, json({ status: "missing" }, { status: 404 }));
    }
    if (bundle.status === "forbidden") {
      return withCors(request, json({ status: "forbidden" }, { status: 403 }));
    }

    return withCors(
      request,
      json({
        status: "ok",
        simulationId: bundle.simulationId,
        siteLibrary: bundle.sites,
        simulationPresets: [bundle.simulation],
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 500);
  }
};
