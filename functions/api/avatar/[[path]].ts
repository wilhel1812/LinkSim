import { handleOptions, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.AVATAR_BUCKET) {
    return withCors(request, new Response("Avatar storage not configured", { status: 503 }));
  }
  const url = new URL(request.url);
  const prefix = "/api/avatar/";
  const raw = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  const key = raw
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/")
    .trim();
  if (!key) {
    return withCors(request, new Response("Missing avatar key", { status: 400 }));
  }
  const object = await env.AVATAR_BUCKET.get(key);
  if (!object?.body) {
    return withCors(request, new Response("Not found", { status: 404 }));
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  return withCors(request, new Response(object.body, { status: 200, headers }));
};
