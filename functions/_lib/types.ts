export type Visibility = "private" | "public_read" | "public_write";
export type ResourceRole = "viewer" | "editor" | "admin";

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
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_INSECURE_DEV_AUTH?: string;
  DEV_AUTH_USER_ID?: string;
  ADMIN_USER_IDS?: string;
};

export type AuthContext = {
  userId: string;
  tokenPayload: Record<string, unknown>;
};
