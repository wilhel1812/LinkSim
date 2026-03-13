export type Visibility = "private" | "public" | "shared";
export type DbVisibility = "private" | "public_read" | "public_write";
export type ResourceRole = "viewer" | "editor" | "admin";
export type UserRole = "admin" | "moderator" | "user" | "pending";

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
  AVATAR_BUCKET?: R2Bucket;
  AVATAR_PUBLIC_BASE_URL?: string;
  AVATAR_FALLBACK_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  AUTH_OBSERVABILITY?: string;
  ALLOW_INSECURE_DEV_AUTH?: string;
  DEV_AUTH_USER_ID?: string;
  ADMIN_USER_IDS?: string;
  REGISTRATION_MODE?: string;
  CF_PAGES_URL?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
  GEOCODE_RATE_LIMIT_PER_MINUTE?: string;
  PROXY_RATE_LIMIT_PER_MINUTE?: string;
  VE2DBE_TILELIST_RATE_LIMIT_PER_MINUTE?: string;
};

export type AuthContext = {
  userId: string;
  tokenPayload: Record<string, unknown>;
  source?: "jwt" | "headers" | "dev";
};
