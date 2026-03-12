import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthContext, Env } from "./types";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const bearerTokenFrom = (request: Request): string | null => {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
};

const remoteJwksFor = (url: string) => {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, jwks);
  return jwks;
};

export const verifyAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const token = bearerTokenFrom(request);
  if (!token) return null;

  const issuer = (env.CLERK_JWT_ISSUER ?? "").trim();
  if (!issuer) return null;
  const jwksUrl = (env.CLERK_JWKS_URL ?? `${issuer}/.well-known/jwks.json`).trim();
  if (!jwksUrl) return null;

  const audience = (env.CLERK_JWT_AUDIENCE ?? "").trim();
  const jwks = remoteJwksFor(jwksUrl);

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: audience || undefined,
  });

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) return null;

  return {
    userId,
    tokenPayload: payload as Record<string, unknown>,
  };
};
