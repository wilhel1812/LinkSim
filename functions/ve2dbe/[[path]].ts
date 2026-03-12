import { handleOptions } from "../_lib/http";
import type { Env } from "../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/ve2dbe/, "");
  const upstream = new URL(`https://www.ve2dbe.com${upstreamPath}${url.search}`);

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
