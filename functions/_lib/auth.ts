import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { resolveCurrentAuthIdentity, resolveMappedAuthIdentityByVerifiedEmail } from "./authIdentityMap";
import {
  BETTER_AUTH_MAPPED_IDENTITY_CLAIM,
  type AuthContext,
  type AuthRequestData,
  type AuthRuntimeSessionResult,
  type Env,
} from "./types";


export class AuthVerificationTimeoutError extends Error {
  constructor() {
    super("Auth verification timed out");
    this.name = "AuthVerificationTimeoutError";
  }
}

export class AuthRuntimeUnavailableError extends Error {
  constructor() {
    super("Authentication runtime unavailable");
    this.name = "AuthRuntimeUnavailableError";
  }
}

type AccessTokenVerifier = (token: string, env: Env) => Promise<JWTPayload>;

const accessKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const VERIFIED_IDP_EMAIL_CLAIM = "__linksim_verified_idp_email";
const authRequestCache = new WeakMap<Request, Promise<AuthContext | null>>();
const authResponseCookieCache = new WeakMap<Request, string[]>();
const FORWARDED_AUTH_HEADERS = [
  "cookie",
  "content-type",
  "accept",
  "user-agent",
  "cf-connecting-ip",
] as const;

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

const configuredAccessAudiences = (env: Env): Set<string> =>
  new Set(
    (env.ACCESS_AUD ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

const hasConfiguredAudience = (payload: Record<string, unknown>, env: Env): boolean => {
  const configured = configuredAccessAudiences(env);
  if (configured.size === 0) return true;
  const tokenAudiences = Array.isArray(payload.aud)
    ? payload.aud.filter((value): value is string => typeof value === "string")
    : typeof payload.aud === "string"
      ? [payload.aud]
      : [];
  return tokenAudiences.some((audience) => configured.has(audience.trim()));
};

const verifyAccessToken: AccessTokenVerifier = async (token, env) => {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? "");
  const audiences = [...configuredAccessAudiences(env)];
  if (!teamDomain || audiences.length === 0) {
    throw new Error("Cloudflare Access issuer and audience must be configured");
  }
  let keySet = accessKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    accessKeySets.set(teamDomain, keySet);
  }
  const { payload } = await jwtVerify(token, keySet, {
    issuer: `https://${teamDomain}`,
    audience: audiences,
  });
  return payload;
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

const decodeCfAccessJwt = async (
  token: string,
  request: Request,
  env: Env,
  verifier: AccessTokenVerifier,
): Promise<AuthContext | null> => {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? "");
  try {
    const payload = (await verifier(token, env)) as Record<string, unknown>;

    // Sanity-check: reject tokens not issued by our Access team domain.
    if (teamDomain) {
      const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
      if (iss && !iss.includes(teamDomain)) return null;
    }

    if (!hasConfiguredAudience(payload, env)) return null;

    // Reject expired tokens.
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    if (exp !== null && exp < Math.floor(Date.now() / 1000)) return null;

    const fallback = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const fromHeader = normalizeUserId(request);
    const userId = fallback || fromHeader;
    if (!userId) return null;

    const verifiedIdpEmail =
      typeof payload.email === "string" && payload.email.trim()
        ? payload.email.trim().toLowerCase()
        : undefined;
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
        [VERIFIED_IDP_EMAIL_CLAIM]: verifiedIdpEmail,
      },
      verifiedIdpEmail,
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

const verifyAccessAuth = async (
  request: Request,
  env: Env,
  verifier: AccessTokenVerifier = verifyAccessToken,
): Promise<AuthContext | null> => {
  const authSignals = inspectAuthRequest(request);
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    readAccessJwtFromCookie(request) ??
    "";

  if (token.trim()) {
    const decoded = await decodeCfAccessJwt(token.trim(), request, env, verifier);
    if (decoded) {
      emitAuthLog(env, { result: "ok", source: decoded.source, ...authSignals });
      return decoded;
    }
    emitAuthLog(env, { result: "fail", reason: "jwt_decode_failed", ...authSignals });
  }

  if (configuredAccessAudiences(env).size > 0) {
    const dev = allowInsecureDevAuth(env);
    if (dev) {
      emitAuthLog(env, { result: "ok", source: dev.source, ...authSignals });
      return dev;
    }
    emitAuthLog(env, { result: "fail", reason: "access_audience_unverified", ...authSignals });
    return null;
  }

  const byHeader = verifyByHeadersOnly(request);
  if (byHeader) {
    emitAuthLog(env, { result: "ok", source: byHeader.source, ...authSignals });
    return byHeader;
  }

  const dev = allowInsecureDevAuth(env);
  if (dev) {
    emitAuthLog(env, { result: "ok", source: dev.source, ...authSignals });
    return dev;
  }
  emitAuthLog(env, { result: "fail", reason: "no_auth_context", ...authSignals });
  return null;
};

type BetterAuthResult =
  | { kind: "no-session"; setCookieHeaders: string[] }
  | { kind: "authenticated"; authUserId: string; setCookieHeaders: string[] };

const checkBetterAuthSession = async (
  request: Request,
  env: Env,
): Promise<BetterAuthResult> => {
  if (!env.AUTH) throw new AuthRuntimeUnavailableError();

  const headers = new Headers();
  for (const name of FORWARDED_AUTH_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") === requestOrigin) {
    headers.set("origin", requestOrigin);
  }

  let result: AuthRuntimeSessionResult;
  try {
    result = await env.AUTH.getByName("auth").checkSession(new Request(
      `${requestOrigin}/api/auth/get-session`,
      { method: "GET", headers },
    ));
  } catch {
    throw new AuthRuntimeUnavailableError();
  }

  const setCookieHeaders = Array.isArray(result.setCookies)
    ? result.setCookies.filter((cookie): cookie is string => typeof cookie === "string" && cookie.length > 0)
    : [];
  if (result.status === 401) return { kind: "no-session", setCookieHeaders };
  if (result.status !== 200 || typeof result.authUserId !== "string" || !result.authUserId.trim()) {
    throw new AuthRuntimeUnavailableError();
  }

  const authUserId = result.authUserId.trim();
  return { kind: "authenticated", authUserId, setCookieHeaders };
};

const resolveBetterAuthContext = async (
  env: Env,
  session: Extract<BetterAuthResult, { kind: "authenticated" }>,
): Promise<AuthContext | null> => {
  let mapping;
  try {
    mapping = await resolveCurrentAuthIdentity(env.DB, session.authUserId);
  } catch {
    // Once Better Auth has authenticated a session, never switch that request
    // to an Access identity because application identity resolution failed.
    throw new AuthRuntimeUnavailableError();
  }
  if (!mapping) return null;
  return {
    userId: mapping.linksimUserId,
    authUserId: session.authUserId,
    source: "better-auth",
    setCookieHeaders: session.setCookieHeaders,
    tokenPayload: {
      [BETTER_AUTH_MAPPED_IDENTITY_CLAIM]: true,
    },
  };
};

const resolveTransitionAccessContext = async (
  request: Request,
  env: Env,
  verifier: AccessTokenVerifier,
): Promise<AuthContext | null> => {
  const access = await verifyAccessAuth(request, env, verifier);
  if (!access || (access.source !== "jwt" && access.source !== "headers")) return access;
  const rawEmail = access.verifiedIdpEmail ?? "";
  const email = rawEmail.trim().toLowerCase();
  if (!email) return access;
  try {
    const mapped = await resolveMappedAuthIdentityByVerifiedEmail(env.DB, email);
    if (!mapped) return access;
    return {
      ...access,
      userId: mapped.linksimUserId,
      verifiedIdpEmail: email,
      tokenPayload: {
        ...access.tokenPayload,
        [BETTER_AUTH_MAPPED_IDENTITY_CLAIM]: true,
      },
    };
  } catch {
    throw new AuthRuntimeUnavailableError();
  }
};

const verifyConfiguredAuth = async (
  request: Request,
  env: Env,
  verifier: AccessTokenVerifier,
  data?: AuthRequestData,
): Promise<AuthContext | null> => {
  const source = env.AUTH_SESSION_SOURCE ?? "access";
  if (source === "access") return verifyAccessAuth(request, env, verifier);

  let betterAuth: BetterAuthResult;
  try {
    betterAuth = await checkBetterAuthSession(request, env);
  } catch (error) {
    if (source === "better-auth") throw error;
    emitAuthLog(env, { result: "fallback", source: "better-auth", reason: "runtime_unavailable" });
    return resolveTransitionAccessContext(request, env, verifier);
  }

  if (betterAuth.kind === "authenticated") {
    const context = await resolveBetterAuthContext(env, betterAuth);
    authResponseCookieCache.set(request, betterAuth.setCookieHeaders);
    if (data) data.authResponseCookies = betterAuth.setCookieHeaders;
    emitAuthLog(env, {
      result: context ? "ok" : "fail",
      source: "better-auth",
      reason: context ? undefined : "identity_mapping_invalid",
    });
    return context;
  }
  authResponseCookieCache.set(request, betterAuth.setCookieHeaders);
  if (data) data.authResponseCookies = betterAuth.setCookieHeaders;
  if (source === "better-auth") return null;

  return resolveTransitionAccessContext(request, env, verifier);
};

export const authResponseCookies = (request: Request, data?: AuthRequestData): string[] =>
  data?.authResponseCookies ?? authResponseCookieCache.get(request) ?? [];

export const verifyAuth = (
  request: Request,
  env: Env,
  data?: AuthRequestData,
  verifier: AccessTokenVerifier = verifyAccessToken,
): Promise<AuthContext | null> => {
  if (data?.authPromise) return data.authPromise;
  let pending = authRequestCache.get(request);
  if (!pending) {
    pending = verifyConfiguredAuth(request, env, verifier, data);
    authRequestCache.set(request, pending);
  }
  if (data) data.authPromise = pending;
  return pending;
};
