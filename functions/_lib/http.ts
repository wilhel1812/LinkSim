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

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const assertJsonDepth = (text: string, maxDepth: number): void => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > maxDepth) {
        throw new ApiRequestError(`JSON nesting may not exceed ${maxDepth} levels.`, 422, "json_too_deep");
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
  }
};

export const readBoundedJson = async <T>(
  request: Request,
  options: { maxBytes: number; maxDepth: number },
): Promise<T> => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new ApiRequestError(`Request body exceeds ${options.maxBytes} bytes.`, 413, "request_too_large");
  }
  if (!request.body) throw new ApiRequestError("Request body is required.", 422, "invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > options.maxBytes) {
      await reader.cancel();
      throw new ApiRequestError(`Request body exceeds ${options.maxBytes} bytes.`, 413, "request_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiRequestError("Request body must be valid UTF-8 JSON.", 422, "invalid_json");
  }
  assertJsonDepth(text, options.maxDepth);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiRequestError("Request body must be valid JSON.", 422, "invalid_json");
  }
};

export type CorsOriginDecision = "allowed" | "originless" | "denied";

const LOCAL_VITE_ORIGIN = "http://localhost:5174";
const LOCAL_EDGE_ORIGIN = "http://127.0.0.1:8788";

const normalizeBrowserOrigin = (raw: string): string | null => {
  if (!raw || raw === "null") return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
};

export const getCorsOriginDecision = (request: Request): CorsOriginDecision => {
  const rawOrigin = request.headers.get("origin");
  if (rawOrigin === null) return "originless";

  const origin = normalizeBrowserOrigin(rawOrigin);
  if (!origin) return "denied";

  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return "allowed";
  if (origin === LOCAL_VITE_ORIGIN && requestOrigin === LOCAL_EDGE_ORIGIN) return "allowed";
  return "denied";
};

export const corsHeaders = (request: Request): Headers => {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  if (getCorsOriginDecision(request) === "allowed") {
    headers.set("Access-Control-Allow-Origin", normalizeBrowserOrigin(request.headers.get("origin")!)!);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  return headers;
};

export const corsRejectionResponse = (request: Request): Response | null => {
  if (getCorsOriginDecision(request) !== "denied") return null;
  return json(
    { error: "Forbidden." },
    { status: 403, headers: corsHeaders(request) },
  );
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

export const handleOptions = (request: Request): Response => {
  const rejected = corsRejectionResponse(request);
  if (rejected) return rejected;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
};

const isRevokedAuthMessage = (message: string): boolean => {
  const lower = message.toLowerCase();
  return lower.includes("session revoked by admin")
    || lower.includes("identity subject is no longer current")
    || lower.includes("identity is blocked by an administrator");
};

export const isRevokedAuthError = (error: unknown): boolean =>
  isRevokedAuthMessage(error instanceof Error ? error.message : String(error));

export const normalizeApiErrorMessage = (message: string): string => {
  const lower = message.toLowerCase();
  if (isRevokedAuthMessage(message)) return "Session revoked by admin.";
  if (lower.includes("auth verification timed out")) return "Auth verification timed out.";
  if (lower.includes("access revoked by admin")) return "Account access revoked by admin.";
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
  if (lower.includes("schema out of date")) return 503;
  if (lower.includes("auth verification timed out")) return 503;
  if (isRevokedAuthMessage(message)) return 401;
  if (lower.includes("access revoked by admin")) return 403;
  if (lower.includes("unauthorized")) return 401;
  if (lower.includes("pending approval")) return 403;
  if (lower.includes("forbidden")) return 403;
  if (lower.includes("not found")) return 404;
  if (lower.includes("required") || lower.includes("must be valid") || lower.includes("invalid")) return 400;
  return fallback;
};

const codeFromErrorMessage = (message: string): string | null => {
  const lower = message.toLowerCase();
  if (lower.includes("auth verification timed out")) return "auth_timeout";
  if (lower.includes("schema out of date")) return "schema_unavailable";
  return null;
};

export const errorResponse = (request: Request, error: unknown, fallback = 500): Response => {
  const message = error instanceof Error ? error.message : String(error);
  const explicitStatus = error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : null;
  const explicitCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  const code = explicitCode ?? codeFromErrorMessage(message);
  return withCors(
    request,
    json(
      code
        ? {
            error: normalizeApiErrorMessage(message),
            code,
          }
        : {
            error: normalizeApiErrorMessage(message),
          },
      { status: explicitStatus ?? statusFromErrorMessage(message, fallback) },
    ),
  );
};
