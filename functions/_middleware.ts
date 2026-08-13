import { corsRejectionResponse } from "./_lib/http";

const CANONICAL_HOSTS: Readonly<Record<string, string>> = {
  "linksim-staging.pages.dev": "staging.linksim.link",
  "linksim.pages.dev": "linksim.link",
};

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const corsRejection = corsRejectionResponse(request);
    if (corsRejection) return corsRejection;
  }

  const canonicalHost = CANONICAL_HOSTS[url.hostname.toLowerCase()];
  if (!canonicalHost) return next();

  url.hostname = canonicalHost;
  url.protocol = "https:";
  url.port = "";
  return Response.redirect(url.toString(), 308);
};
