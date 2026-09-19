-- Additive Better Auth schema for the staging compatibility integration.
-- Generated from the reviewed Better Auth 1.7.3 D1 experiment and namespaced
-- so it cannot overlap LinkSim's application identity tables.

CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt date NOT NULL,
  updatedAt date NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT NOT NULL PRIMARY KEY,
  expiresAt date NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt date NOT NULL,
  updatedAt date NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_account (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt date,
  refreshTokenExpiresAt date,
  scope TEXT,
  password TEXT,
  createdAt date NOT NULL,
  updatedAt date NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_verification (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt date NOT NULL,
  createdAt date NOT NULL,
  updatedAt date NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_passkey (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt date,
  aaguid TEXT
);

CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id TEXT NOT NULL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_identity_map (
  auth_user_id TEXT NOT NULL PRIMARY KEY REFERENCES auth_user(id),
  linksim_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_session_userId_idx ON auth_session(userId);
CREATE INDEX IF NOT EXISTS auth_account_userId_idx ON auth_account(userId);
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
CREATE INDEX IF NOT EXISTS auth_passkey_userId_idx ON auth_passkey(userId);
CREATE INDEX IF NOT EXISTS auth_passkey_credentialID_idx ON auth_passkey(credentialID);
