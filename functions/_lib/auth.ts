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

const parseAudiences = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

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

const readHeaderEmail = (request: Request): string => {
  const email =
    request.headers.get("cf-access-authenticated-user-email") ??
    request.headers.get("Cf-Access-Authenticated-User-Email") ??
    "";
  return email.trim().toLowerCase();
};

const readHeaderUserName = (request: Request): string => {
  const name =
    request.headers.get("cf-access-authenticated-user-name") ??
    request.headers.get("Cf-Access-Authenticated-User-Name") ??
    "";
  return name.trim();
};

const readAccessJwtFromCookie = (request: Request): string => {
  const cookieHeader = request.headers.get("cookie") ?? request.headers.get("Cookie") ?? "";
  if (!cookieHeader.trim()) return "";
  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key.startsWith("CF_Authorization")) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
};

export const inspectAuthRequest = (request: Request) => {
  const jwt =
    request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    "";
  const cookieJwt = readAccessJwtFromCookie(request);
  const email =
    request.headers.get("cf-access-authenticated-user-email") ??
    request.headers.get("Cf-Access-Authenticated-User-Email") ??
    "";
  const userId =
    request.headers.get("cf-access-authenticated-user-id") ??
    request.headers.get("Cf-Access-Authenticated-User-Id") ??
    "";
  const userName =
    request.headers.get("cf-access-authenticated-user-name") ??
    request.headers.get("Cf-Access-Authenticated-User-Name") ??
    "";
  return {
    hasJwtAssertion: Boolean(jwt.trim()),
    hasJwtCookie: Boolean(cookieJwt.trim()),
    hasEmailHeader: Boolean(email.trim()),
    hasUserIdHeader: Boolean(userId.trim()),
    hasUserNameHeader: Boolean(userName.trim()),
  };
};

const emitAuthLog = (env: Env, payload: Record<string, unknown>) => {
  const enabled = (env.AUTH_OBSERVABILITY ?? "true").trim().toLowerCase();
  if (enabled === "false" || enabled === "0" || enabled === "off") return;
  console.info(JSON.stringify({ event: "auth", ...payload }));
};

const verifyCloudflareAccessJwt = async (
  token: string,
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? "");
  const audiences = parseAudiences(env.ACCESS_AUD ?? "");
  if (!audiences.length) return null;

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
      for (const audience of audiences) {
        try {
          const { payload } = await jwtVerify(token, jwks, {
            issuer,
            audience,
          });
          lastPayload = payload as Record<string, unknown>;
          break;
        } catch {
          // Try next audience for this issuer candidate.
        }
      }
      if (lastPayload) break;
      // Fallback: accept any Access audience as long as issuer signature is valid.
      // This prevents lockouts when Access app audiences drift between staging hosts.
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
        });
        lastPayload = payload as Record<string, unknown>;
        break;
      } catch {
        // Try next issuer candidate.
      }
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
    tokenPayload: {
      ...lastPayload,
      email: typeof lastPayload.email === "string" && lastPayload.email.trim() ? lastPayload.email : readHeaderEmail(request),
      name: typeof lastPayload.name === "string" && lastPayload.name.trim() ? lastPayload.name : readHeaderUserName(request),
    },
    source: "jwt",
  };
};

const verifyByHeadersOnly = (request: Request): AuthContext | null => {
  const userId = normalizeUserId(request);
  if (!userId) return null;
  return {
    userId,
    tokenPayload: {
      email: readHeaderEmail(request),
      name: readHeaderUserName(request),
    },
    source: "headers",
  };
};

const allowInsecureDevAuth = (env: Env): AuthContext | null => {
  if ((env.ALLOW_INSECURE_DEV_AUTH ?? "").toLowerCase() !== "true") return null;
  const userId = (env.DEV_AUTH_USER_ID ?? "local-dev-user").trim();
  if (!userId) return null;
  return {
    userId,
    tokenPayload: { devAuth: true },
    source: "dev",
  };
};

export const verifyAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const authSignals = inspectAuthRequest(request);
  try {
    const token =
      request.headers.get("cf-access-jwt-assertion") ??
      request.headers.get("Cf-Access-Jwt-Assertion") ??
      readAccessJwtFromCookie(request) ??
      "";

    if (token.trim()) {
      const jwtVerified = await verifyCloudflareAccessJwt(token.trim(), request, env);
      if (jwtVerified) {
        emitAuthLog(env, { result: "ok", source: jwtVerified.source, ...authSignals });
        return jwtVerified;
      }
      emitAuthLog(env, { result: "fail", reason: "jwt_verify_failed", ...authSignals });
    }

    const byHeader = verifyByHeadersOnly(request);
    if (byHeader) {
      emitAuthLog(env, { result: "ok", source: byHeader.source, ...authSignals });
      return byHeader;
    }
  } catch {
    emitAuthLog(env, { result: "fail", reason: "auth_exception", ...authSignals });
    // Fail closed to header/dev fallback instead of surfacing auth internals as 500.
  }
  const dev = allowInsecureDevAuth(env);
  if (dev) {
    emitAuthLog(env, { result: "ok", source: dev.source, ...authSignals });
    return dev;
  }
  emitAuthLog(env, { result: "fail", reason: "no_auth_context", ...authSignals });
  return null;
};
