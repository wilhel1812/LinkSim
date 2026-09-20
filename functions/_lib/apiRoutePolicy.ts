const PUBLIC_GET_PATHS = new Set([
  "/api/public-simulation",
  "/api/deep-link-status",
  "/api/stats",
  "/api/health",
  "/api/auth-start",
]);

const isApiPath = (pathname: string): boolean =>
  pathname === "/api" || pathname.startsWith("/api/");

const PUBLIC_AUTH_ROUTES = new Set([
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/github",
  "POST /api/auth/sign-out",
  "GET /api/auth/passkey/generate-authenticate-options",
  "POST /api/auth/passkey/verify-authentication",
]);

const AUTH_GATEWAY_ROUTES = new Set([
  ...PUBLIC_AUTH_ROUTES,
  "GET /api/auth/passkey/generate-register-options",
  "POST /api/auth/passkey/verify-registration",
  "GET /api/auth/passkey/list-user-passkeys",
  "POST /api/auth/passkey/update-passkey",
  "POST /api/auth/passkey/delete-passkey",
]);

export const isExposedAuthRoute = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  return PUBLIC_AUTH_ROUTES.has(`${request.method.toUpperCase()} ${pathname}`);
};

export const isAuthGatewayRoute = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  return AUTH_GATEWAY_ROUTES.has(`${request.method.toUpperCase()} ${pathname}`);
};

export const requiresApiAuthentication = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  if (!isApiPath(pathname)) return false;
  if (request.method.toUpperCase() === "OPTIONS") return false;
  if (isExposedAuthRoute(request)) return false;
  if (request.method.toUpperCase() !== "GET") return true;
  if (PUBLIC_GET_PATHS.has(pathname)) return false;
  return !(pathname === "/api/avatar" || pathname.startsWith("/api/avatar/"));
};

export const requiresMutationOrigin = (request: Request): boolean =>
  !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());

export const hasExactRequestOrigin = (request: Request): boolean =>
  request.headers.get("origin") === new URL(request.url).origin;
