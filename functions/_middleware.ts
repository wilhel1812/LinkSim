const CANONICAL_HOSTS: Readonly<Record<string, string>> = {
  "linksim-staging.pages.dev": "staging.linksim.link",
  "linksim.pages.dev": "linksim.link",
};

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  const canonicalHost = CANONICAL_HOSTS[url.hostname.toLowerCase()];
  if (!canonicalHost) return next();

  url.hostname = canonicalHost;
  url.protocol = "https:";
  url.port = "";
  return Response.redirect(url.toString(), 308);
};
