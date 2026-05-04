import { decodeJwt } from "jose";
import type { AuthContext, Env } from "./types";


export class AuthVerificationTimeoutError extends Error {
  constructor() {
    super("Auth verification timed out");
    this.name = "AuthVerificationTimeoutError";
  }
}

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

const normalizeUserId = (request: Request): string => {
  const bySub =
    request.headers.get("cf-access-authenticated-user-id") ??
    request.headers.get("Cf-Access-Authenticated-User-Id") ??
    "";
  if (bySub.trim()) return bySub.trim();
  const byEmail =
    request.headers.get("cf-access-authenticated-user-email") ??
    request.headers.get("Cf-Access-Authenticated-User-Email") ??
    "";
  return byEmail.trim().toLowerCase();
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

// CF Access verifies the JWT signature at the edge before the request reaches
// the worker. Decoding without re-verification is safe: the worker is only
// reachable through the CF Access gate, so any token present was already
// validated by Cloudflare.
const decodeCfAccessJwt = (token: string, request: Request, env: Env): AuthContext | null => {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? "");
  try {
    const payload = decodeJwt(token) as Record<string, unknown>;

    // Sanity-check: reject tokens not issued by our Access team domain.
    if (teamDomain) {
      const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
      if (iss && !iss.includes(teamDomain)) return null;
    }

    // Reject expired tokens.
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    if (exp !== null && exp < Math.floor(Date.now() / 1000)) return null;

    const fallback = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const fromHeader = normalizeUserId(request);
    const userId = fromHeader || fallback;
    if (!userId) return null;

    return {
      userId,
      tokenPayload: {
        ...payload,
        email:
          typeof payload.email === "string" && payload.email.trim()
            ? payload.email
            : readHeaderEmail(request),
        name:
          typeof payload.name === "string" && payload.name.trim()
            ? payload.name
            : readHeaderUserName(request),
      },
      source: "jwt",
    };
  } catch {
    return null;
  }
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
  const envFlag = (env.ALLOW_INSECURE_DEV_AUTH ?? "").toLowerCase();

  const processEnv =
    typeof process !== "undefined" && process?.env ? process.env : undefined;

  const processFlag = (processEnv?.ALLOW_INSECURE_DEV_AUTH ?? "").toLowerCase();
  const allowProcessFallback = processFlag === "true";
  const allowDevAuth = envFlag === "true" || (allowProcessFallback && !envFlag);
  if (!allowDevAuth) return null;

  const userId = (
    env.DEV_AUTH_USER_ID ??
    (allowProcessFallback ? processEnv?.DEV_AUTH_USER_ID : undefined) ??
    "local-dev-user"
  ).trim();

  if (!userId) return null;
  return {
    userId,
    tokenPayload: { devAuth: true },
    source: "dev",
  };
};

export const verifyAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const authSignals = inspectAuthRequest(request);

  const byHeader = verifyByHeadersOnly(request);
  if (byHeader) {
    emitAuthLog(env, { result: "ok", source: byHeader.source, ...authSignals });
    return byHeader;
  }

  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    readAccessJwtFromCookie(request) ??
    "";

  if (token.trim()) {
    const decoded = decodeCfAccessJwt(token.trim(), request, env);
    if (decoded) {
      emitAuthLog(env, { result: "ok", source: decoded.source, ...authSignals });
      return decoded;
    }
    emitAuthLog(env, { result: "fail", reason: "jwt_decode_failed", ...authSignals });
  }

  const dev = allowInsecureDevAuth(env);
  if (dev) {
    emitAuthLog(env, { result: "ok", source: dev.source, ...authSignals });
    return dev;
  }
  emitAuthLog(env, { result: "fail", reason: "no_auth_context", ...authSignals });
  return null;
};
