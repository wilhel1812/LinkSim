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

const normalizeTeamDomain = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.host.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
};

const decodeIssuerFromJwt = (token: string): string => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return "";
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${b64}${"=".repeat((4 - (b64.length % 4)) % 4)}`;
    const decoded = JSON.parse(atob(padded)) as {
      iss?: unknown;
    };
    return typeof decoded.iss === "string" ? decoded.iss.trim() : "";
  } catch {
    return "";
  }
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
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? "");
  const audience = (env.ACCESS_AUD ?? "").trim();
  if (!audience) return null;

  const tokenIssuer = decodeIssuerFromJwt(token);
  const issuerCandidates = [
    teamDomain ? `https://${teamDomain}` : "",
    tokenIssuer,
  ].filter(Boolean);

  let lastPayload: Record<string, unknown> | null = null;
  for (const issuer of Array.from(new Set(issuerCandidates))) {
    try {
      const jwksUrl = `${issuer}/cdn-cgi/access/certs`;
      const jwks = remoteJwksFor(jwksUrl);
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
      });
      lastPayload = payload as Record<string, unknown>;
      break;
    } catch {
      // Try next issuer candidate.
    }
  }

  if (!lastPayload) return null;

  const fallback = typeof lastPayload.sub === "string" ? lastPayload.sub : "";
  const fromHeader = normalizeUserId(request);
  const userId = fromHeader || fallback;
  if (!userId) return null;

  return {
    userId,
    tokenPayload: lastPayload,
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
  try {
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
  } catch {
    // Fail closed to header/dev fallback instead of surfacing auth internals as 500.
  }
  return allowInsecureDevAuth(env);
};
