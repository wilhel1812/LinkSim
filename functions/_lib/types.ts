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
  CLERK_JWT_ISSUER: string;
  CLERK_JWKS_URL?: string;
  CLERK_JWT_AUDIENCE?: string;
};

export type AuthContext = {
  userId: string;
  tokenPayload: Record<string, unknown>;
};
