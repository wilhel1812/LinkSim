import { handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request }) =>
  withCors(
    request,
    json({
      ok: true,
      service: "linksim-api",
      ts: new Date().toISOString(),
    }),
  );
