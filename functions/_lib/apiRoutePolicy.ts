const PUBLIC_GET_PATHS = new Set([
  "/api/public-simulation",
  "/api/deep-link-status",
  "/api/stats",
  "/api/health",
  "/api/auth-start",
]);

const isApiPath = (pathname: string): boolean =>
  pathname === "/api" || pathname.startsWith("/api/");

const EXPOSED_AUTH_ROUTES = new Set([
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/github",
  "POST /api/auth/sign-out",
]);

export const isExposedAuthRoute = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  return EXPOSED_AUTH_ROUTES.has(`${request.method.toUpperCase()} ${pathname}`);
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
