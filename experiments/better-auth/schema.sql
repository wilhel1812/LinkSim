create table "probe_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "probe_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "probe_user" ("id") on delete cascade);

create table "probe_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "probe_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "probe_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "probe_passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "probe_user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);

create table "probe_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "probe_session_userId_idx" on "probe_session" ("userId");

create index "probe_account_userId_idx" on "probe_account" ("userId");

create index "probe_verification_identifier_idx" on "probe_verification" ("identifier");

create index "probe_passkey_userId_idx" on "probe_passkey" ("userId");

create index "probe_passkey_credentialID_idx" on "probe_passkey" ("credentialID");