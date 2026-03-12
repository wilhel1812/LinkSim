import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthContext, Env } from "./types";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const remoteJwksFor = (url: string) => {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, jwks);
  return jwks;
};

const normalizeUserId = (request: Request): string => {
  const byEmail =
    request.headers.get("cf-access-authenticated-user-email") ??
    request.headers.get("Cf-Access-Authenticated-User-Email") ??
    "";
  if (byEmail.trim()) return byEmail.trim().toLowerCase();
  const bySub =
    request.headers.get("cf-access-authenticated-user-id") ??
    request.headers.get("Cf-Access-Authenticated-User-Id") ??
    "";
  return bySub.trim();
};

const verifyCloudflareAccessJwt = async (
  token: string,
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? "").trim();
  const audience = (env.ACCESS_AUD ?? "").trim();
  if (!teamDomain || !audience) return null;

  const issuer = `https://${teamDomain}`;
  const jwksUrl = `${issuer}/cdn-cgi/access/certs`;
  const jwks = remoteJwksFor(jwksUrl);

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
  });

  const fallback = typeof payload.sub === "string" ? payload.sub : "";
  const fromHeader = normalizeUserId(request);
  const userId = fromHeader || fallback;
  if (!userId) return null;

  return {
    userId,
    tokenPayload: payload as Record<string, unknown>,
  };
};

const verifyByHeadersOnly = (request: Request): AuthContext | null => {
  const userId = normalizeUserId(request);
  if (!userId) return null;
  return { userId, tokenPayload: {} };
};

const allowInsecureDevAuth = (env: Env): AuthContext | null => {
  if ((env.ALLOW_INSECURE_DEV_AUTH ?? "").toLowerCase() !== "true") return null;
  const userId = (env.DEV_AUTH_USER_ID ?? "local-dev-user").trim();
  if (!userId) return null;
  return {
    userId,
    tokenPayload: { devAuth: true },
  };
};

export const verifyAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    "";

  if (token.trim()) {
    const jwtVerified = await verifyCloudflareAccessJwt(token.trim(), request, env);
    if (jwtVerified) return jwtVerified;
  }

  const byHeader = verifyByHeadersOnly(request);
  if (byHeader) return byHeader;

  return allowInsecureDevAuth(env);
};
