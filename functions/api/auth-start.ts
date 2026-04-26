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

export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"), url.origin);
  return Response.redirect(`${url.origin}${returnTo}`, 302);
};
