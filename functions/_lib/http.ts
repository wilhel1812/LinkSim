export const json = (body: unknown, init?: ResponseInit): Response => {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
};

export const corsHeaders = (request: Request): Headers => {
  const origin = request.headers.get("origin") ?? "*";
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  return headers;
};

export const withCors = (request: Request, response: Response): Response => {
  const headers = corsHeaders(request);
  const merged = new Headers(response.headers);
  headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
};

export const handleOptions = (request: Request): Response =>
  new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });

export const normalizeApiErrorMessage = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes("session revoked by admin")) return "Session revoked by admin.";
  if (lower.includes("pending approval")) return "Account pending approval.";
  if (lower.includes("unauthorized")) return "Unauthorized.";
  if (lower.includes("forbidden")) return "Forbidden.";
  if (lower.includes("not found")) return "Not found.";
  if (lower.includes("required") || lower.includes("must be valid") || lower.includes("missing ")) {
    return message;
  }
  return message || "Request failed.";
};

export const statusFromErrorMessage = (message: string, fallback = 500): number => {
  const lower = message.toLowerCase();
  if (lower.includes("session revoked by admin")) return 401;
  if (lower.includes("unauthorized")) return 401;
  if (lower.includes("pending approval")) return 403;
  if (lower.includes("forbidden")) return 403;
  if (lower.includes("not found")) return 404;
  if (lower.includes("required") || lower.includes("must be valid") || lower.includes("invalid")) return 400;
  return fallback;
};

export const errorResponse = (request: Request, error: unknown, fallback = 500): Response => {
  const message = error instanceof Error ? error.message : String(error);
  return withCors(
    request,
    json(
      {
        error: normalizeApiErrorMessage(message),
      },
      { status: statusFromErrorMessage(message, fallback) },
    ),
  );
};
