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
