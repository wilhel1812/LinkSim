import { handleOptions, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";
import {
  assertAvatarFormat,
  avatarUrlForObjectKey,
  avatarVariantMaxBytes,
  parseAvatarObjectKey,
  readBoundedAvatarBody,
} from "../../../src/lib/avatarLimits";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.AVATAR_BUCKET) {
    return withCors(request, new Response("Avatar storage not configured", { status: 503 }));
  }
  const url = new URL(request.url);
  const prefix = "/api/avatar/";
  const raw = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  let key: string;
  try {
    if (!raw) throw new Error("missing");
    key = parseAvatarObjectKey(raw);
  } catch {
    return withCors(request, new Response(raw ? "Invalid avatar key" : "Missing avatar key", { status: 400 }));
  }
  const object = await env.AVATAR_BUCKET.get(key);
  if (!object?.body) {
    const fallbackRaw = (env.AVATAR_FALLBACK_ORIGIN ?? "").trim();
    let fallbackOrigin = "";
    try {
      const parsed = new URL(fallbackRaw);
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password
        && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.origin !== url.origin) {
        fallbackOrigin = parsed.origin;
      }
    } catch {
      // Invalid fallback configuration is treated as unavailable.
    }
    if (fallbackOrigin) {
      const fallbackUrl = `${fallbackOrigin}${avatarUrlForObjectKey(key)}`;
      try {
        const upstream = await fetch(fallbackUrl, {
          headers: { accept: request.headers.get("accept") ?? "*/*" },
          redirect: "manual",
        });
        if (upstream.ok && upstream.body) {
          const bytes = await readBoundedAvatarBody(upstream, avatarVariantMaxBytes(key));
          const contentType = assertAvatarFormat(upstream.headers.get("content-type") ?? "", bytes);
          const headers = new Headers({
            "cache-control": upstream.headers.get("cache-control") ?? "public, max-age=3600",
            "content-type": contentType,
            "x-content-type-options": "nosniff",
          });
          const etag = upstream.headers.get("etag");
          if (etag) headers.set("etag", etag);
          return withCors(request, new Response(bytes, { status: 200, headers }));
        }
      } catch {
        // Fall through to standard not-found.
      }
    }
    return withCors(request, new Response("Not found", { status: 404 }));
  }

  try {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const bytes = await readBoundedAvatarBody(new Response(object.body, { headers }), avatarVariantMaxBytes(key));
    const contentType = assertAvatarFormat(headers.get("content-type") ?? "", bytes);
    const safeHeaders = new Headers({
      "cache-control": headers.get("cache-control") ?? "public, max-age=31536000, immutable",
      "content-type": contentType,
      "etag": object.httpEtag,
      "x-content-type-options": "nosniff",
    });
    return withCors(request, new Response(bytes, { status: 200, headers: safeHeaders }));
  } catch {
    return withCors(request, new Response("Invalid avatar object", { status: 502, headers: { "cache-control": "no-store" } }));
  }
};
