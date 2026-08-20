import { json } from "./_lib/http";
import { readPublicSiteNotice } from "./_lib/siteNotice";
import type { Env } from "./_lib/types";

const CACHE_CONTROL = ["public", "max-age=30", "s-maxage=30", "stale-while-revalidate=60"].join(", ");

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const notice = await readPublicSiteNotice(env);
    const headers = new Headers({
      "cache-control": CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    });
    if (notice) {
      const etag = `"site-notice-${notice.revision}"`;
      headers.set("etag", etag);
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
      }
    }
    return json({ notice }, { headers });
  } catch {
    return json(
      { notice: null },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  }
};
