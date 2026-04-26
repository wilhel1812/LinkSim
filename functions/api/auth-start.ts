import type { Env } from "../_lib/types";

const sanitizeReturnTo = (raw: string | null, origin: string): string => {
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  try {
    const resolved = new URL(trimmed, origin);
    if (resolved.origin !== origin) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"), url.origin);
  const redirectUrl = `${url.origin}${returnTo}`;
  const teamDomain = env?.ACCESS_TEAM_DOMAIN;
  if (teamDomain) {
    return Response.redirect(
      `https://${teamDomain}/cdn-cgi/access/login?redirect_url=${encodeURIComponent(redirectUrl)}`,
      302,
    );
  }
  return Response.redirect(redirectUrl, 302);
};
