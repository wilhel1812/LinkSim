export type Visibility = "private" | "public" | "shared";
export type DbVisibility = "private" | "public_read" | "public_write";
export type ResourceRole = "viewer" | "editor" | "admin";
export type UserRole = "admin" | "moderator" | "user" | "pending";

export const BETTER_AUTH_MAPPED_IDENTITY_CLAIM = "__linksim_better_auth_mapped";

export type AuthRuntimeSessionResult = {
  status: number;
  authUserId?: string;
  fresh?: boolean;
  setCookies?: string[];
};

export type AuthRuntimeStub = {
  checkSession(request: Request): Promise<AuthRuntimeSessionResult>;
  fetch(request: Request): Promise<Response>;
};

export type AuthRuntimeNamespace = {
  getByName(name: string): AuthRuntimeStub;
};

export type Grant = {
  userId: string;
  role: ResourceRole;
};

export type CloudResourceRecord = {
  id: string;
  name: string;
  visibility?: Visibility;
  sharedWith?: Grant[];
  [key: string]: unknown;
};

export type LibrarySnapshotPayload = {
  siteLibrary?: CloudResourceRecord[];
  simulationPresets?: CloudResourceRecord[];
};

export type Env = {
  DB: D1Database;
  AUTH?: AuthRuntimeNamespace;
  AUTH_SESSION_SOURCE?: "access" | "transition" | "better-auth";
  AUTH_DUAL_LOGIN_MIGRATION_ENABLED?: string;
  AUTH_LEGACY_CLAIM_ENABLED?: string;
  AUTH_REGISTRATION_ENABLED?: string;
  // Disabled unless explicitly enabled after runtime/storage validation.
  HISTORY_DETAILS_COMPRESSION?: string;
  HISTORY_BUCKET?: R2Bucket;
  HISTORY_SCOPE?: string;
  AVATAR_BUCKET?: R2Bucket;
  AVATAR_PUBLIC_BASE_URL?: string;
  AVATAR_FALLBACK_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  AUTH_OBSERVABILITY?: string;
  AUTH_VERIFY_TIMEOUT_MS?: string;
  ALLOW_INSECURE_DEV_AUTH?: string;
  DEV_AUTH_USER_ID?: string;
  ADMIN_USER_IDS?: string;
  CF_PAGES_URL?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
  GEOCODE_RATE_LIMIT_PER_MINUTE?: string;
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE?: string;
};

export type AuthContext = {
  userId: string;
  tokenPayload: Record<string, unknown>;
  verifiedIdpEmail?: string;
  source?: "jwt" | "headers" | "dev" | "better-auth";
  authUserId?: string;
  setCookieHeaders?: string[];
};

export type AuthRequestData = Record<string, unknown> & {
  authPromise?: Promise<AuthContext | null>;
  authResponseCookies?: string[];
};
