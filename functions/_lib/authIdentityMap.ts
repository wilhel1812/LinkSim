export type AuthIdentityMapConflictCode =
  | "AUTH_USER_ALREADY_MAPPED"
  | "LINKSIM_USER_ALREADY_MAPPED";

export type AuthIdentityMapEligibilityCode =
  | "AUTH_USER_NOT_FOUND"
  | "LINKSIM_USER_NOT_FOUND"
  | "LINKSIM_USER_INELIGIBLE";

export class AuthIdentityMapConflictError extends Error {
  readonly name = "AuthIdentityMapConflictError";

  constructor(readonly code: AuthIdentityMapConflictCode) {
    super(code);
  }
}

export class AuthIdentityMapEligibilityError extends Error {
  readonly name = "AuthIdentityMapEligibilityError";

  constructor(readonly code: AuthIdentityMapEligibilityCode) {
    super(code);
  }
}

export type LegacyAuthMigrationCode =
  | "ATTEMPT_NOT_FOUND"
  | "ATTEMPT_EXPIRED"
  | "ATTEMPT_CONSUMED"
  | "ATTEMPT_IDENTITY_MISMATCH"
  | "LEGACY_IDENTITY_INELIGIBLE"
  | "AUTH_IDENTITY_INELIGIBLE"
  | "IDENTITY_CONFLICT"
  | "MIGRATION_FAILED";

export class LegacyAuthMigrationError extends Error {
  readonly name = "LegacyAuthMigrationError";

  constructor(readonly code: LegacyAuthMigrationCode) {
    super(code);
  }
}

export type AuthIdentityProvisionCode =
  | "AUTH_IDENTITY_INELIGIBLE"
  | "LEGACY_CLAIM_INELIGIBLE"
  | "LEGACY_CLAIM_EXPIRED"
  | "REGISTRATION_DISABLED"
  | "IDENTITY_CONFLICT"
  | "PROVISION_FAILED";

export class AuthIdentityProvisionError extends Error {
  readonly name = "AuthIdentityProvisionError";

  constructor(readonly code: AuthIdentityProvisionCode) {
    super(code);
  }
}

type ProvisionResult = {
  authUserId: string;
  linksimUserId: string;
  created: boolean;
  kind: "existing" | "legacy-claim" | "registration";
};

const normalizedEmail = (value: string) => value.trim().toLowerCase();

async function currentProvisionedIdentity(
  db: D1Database,
  authUserId: string,
  email?: string,
): Promise<ProvisionResult | null> {
  const raw = await findAuthIdentityByAuthUserId(db, authUserId);
  if (!raw) return null;
  const current = await resolveCurrentAuthIdentity(db, authUserId);
  if (!current || current.linksimUserId !== raw.linksimUserId) {
    throw new AuthIdentityProvisionError("IDENTITY_CONFLICT");
  }
  if (email) {
    const claim = await db.prepare(`SELECT current_user_id FROM verified_identity_claims
      WHERE normalized_email = ?`).bind(email).first<{ current_user_id: string }>();
    if (claim && claim.current_user_id !== current.linksimUserId) {
      throw new AuthIdentityProvisionError("IDENTITY_CONFLICT");
    }
  }
  return { ...current, created: false, kind: "existing" };
}

export async function provisionAuthIdentity(
  db: D1Database,
  input: {
    authUserId: string;
    now?: string;
    legacyClaimDeadline: string;
    legacyClaimEnabled: boolean;
    registrationEnabled: boolean;
  },
): Promise<ProvisionResult> {
  const now = input.now ?? new Date().toISOString();
  const accounts = await db.prepare(`
    SELECT auth_user.email, auth_user.emailVerified AS email_verified,
      auth_account.providerId AS provider_id, auth_account.accountId AS account_id
    FROM auth_user
    JOIN auth_account ON auth_account.userId = auth_user.id
    WHERE auth_user.id = ?
  `).bind(input.authUserId).all<{
    email: string;
    email_verified: number;
    provider_id: string;
    account_id: string;
  }>();
  const githubAccounts = accounts.results.filter(row => row.provider_id === "github");
  const auth = githubAccounts.length === 1 ? githubAccounts[0] : null;
  const email = normalizedEmail(auth?.email ?? "");
  if (
    !auth
    || auth.email_verified !== 1
    || !/^\d+$/.test(auth.account_id)
    || !email.includes("@")
  ) throw new AuthIdentityProvisionError("AUTH_IDENTITY_INELIGIBLE");

  const existing = await currentProvisionedIdentity(db, input.authUserId, email);
  if (existing) return existing;

  const claim = await db.prepare(`
    SELECT claim.current_user_id, claim.status AS claim_status,
      user.id AS user_id, user.idp_email, user.idp_email_verified,
      user.is_admin, user.is_moderator, user.is_approved, user.approved_by_user_id,
      deleted.id AS deleted_id, state.status AS subject_status,
      state.normalized_email AS subject_email, state.canonical_user_id,
      mapping.auth_user_id AS mapped_auth_user_id
    FROM verified_identity_claims AS claim
    LEFT JOIN users AS user ON user.id = claim.current_user_id
    LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
    LEFT JOIN identity_subject_states AS state ON state.user_id = user.id
    LEFT JOIN auth_identity_map AS mapping ON mapping.linksim_user_id = user.id
    WHERE claim.normalized_email = ?
  `).bind(email).first<{
    current_user_id: string;
    claim_status: string;
    user_id: string | null;
    idp_email: string | null;
    idp_email_verified: number | null;
    is_admin: number | null;
    is_moderator: number | null;
    is_approved: number | null;
    approved_by_user_id: string | null;
    deleted_id: string | null;
    subject_status: string | null;
    subject_email: string | null;
    canonical_user_id: string | null;
    mapped_auth_user_id: string | null;
  }>();

  if (claim) {
    if (!input.legacyClaimEnabled) {
      throw new AuthIdentityProvisionError("LEGACY_CLAIM_INELIGIBLE");
    }
    if (now > input.legacyClaimDeadline) {
      throw new AuthIdentityProvisionError("LEGACY_CLAIM_EXPIRED");
    }
    if (claim.mapped_auth_user_id && claim.mapped_auth_user_id !== input.authUserId) {
      throw new AuthIdentityProvisionError("IDENTITY_CONFLICT");
    }
    const eligible = claim.claim_status === "active"
      && claim.user_id === claim.current_user_id
      && !claim.deleted_id
      && claim.idp_email_verified === 1
      && normalizedEmail(claim.idp_email ?? "") === email
      && claim.subject_status === "current"
      && normalizedEmail(claim.subject_email ?? "") === email
      && claim.canonical_user_id === claim.user_id
      && claim.is_admin === 0
      && claim.is_moderator === 0
      && claim.is_approved === 1
      && !(claim.approved_by_user_id ?? "").startsWith("revoked:");
    if (!eligible) throw new AuthIdentityProvisionError("LEGACY_CLAIM_INELIGIBLE");

    try {
      const results = await db.batch([
        db.prepare(`
          INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
          SELECT ?, claim.current_user_id, ?
          FROM verified_identity_claims AS claim
          JOIN users AS user ON user.id = claim.current_user_id
          JOIN identity_subject_states AS state ON state.user_id = user.id
          LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
          WHERE claim.normalized_email = ? AND claim.status = 'active'
            AND EXISTS (
              SELECT 1 FROM auth_user AS auth
              JOIN auth_account AS account ON account.userId = auth.id
              WHERE auth.id = ? AND auth.emailVerified = 1
                AND lower(trim(auth.email)) = ?
                AND account.providerId = 'github' AND account.accountId = ?
            )
            AND deleted.id IS NULL AND user.idp_email_verified = 1
            AND lower(trim(user.idp_email)) = ?
            AND state.status = 'current' AND state.canonical_user_id = user.id
            AND state.normalized_email = ?
            AND user.is_admin = 0 AND user.is_moderator = 0 AND user.is_approved = 1
            AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
        `).bind(input.authUserId, now, email, input.authUserId, email, auth.account_id, email, email),
        db.prepare(`
          INSERT INTO user_identity_audit
            (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
          SELECT 'better_auth_legacy_claim', linksim_user_id, NULL, NULL, ?, ?, ?
          FROM auth_identity_map WHERE auth_user_id = ? AND created_at = ?
            AND NOT EXISTS (
              SELECT 1 FROM user_identity_audit
              WHERE event_type = 'better_auth_legacy_claim' AND target_user_id = linksim_user_id
            )
        `).bind(email, JSON.stringify({ provider: "github", authUserId: input.authUserId }), now, input.authUserId, now),
      ]);
      const mapped = await currentProvisionedIdentity(db, input.authUserId);
      if (!mapped) throw new AuthIdentityProvisionError("PROVISION_FAILED");
      return { ...mapped, created: (results[0]?.meta?.changes ?? 0) > 0, kind: "legacy-claim" };
    } catch (error) {
      const winner = await currentProvisionedIdentity(db, input.authUserId);
      if (winner?.linksimUserId === claim.current_user_id) return winner;
      if (error instanceof AuthIdentityProvisionError) throw error;
      throw new AuthIdentityProvisionError("PROVISION_FAILED");
    }
  }

  const legacyEvidence = await db.prepare(`
    SELECT
      EXISTS (SELECT 1 FROM identity_subject_states WHERE normalized_email = ?) AS has_state,
      EXISTS (SELECT 1 FROM users WHERE idp_email_verified = 1 AND lower(trim(idp_email)) = ?) AS has_user
  `).bind(email, email).first<{ has_state: number; has_user: number }>();
  if (legacyEvidence?.has_state || legacyEvidence?.has_user) {
    throw new AuthIdentityProvisionError("LEGACY_CLAIM_INELIGIBLE");
  }
  if (!input.registrationEnabled) {
    throw new AuthIdentityProvisionError("REGISTRATION_DISABLED");
  }

  const linksimUserId = crypto.randomUUID();
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO users
        (id, username, email, bio, access_request_note, idp_email, idp_email_verified,
         avatar_url, email_public, is_admin, is_moderator, is_approved, approved_at,
         approved_by_user_id, created_at, updated_at)
        SELECT ?, '', ?, '', '', ?, 1, '', 1, 0, 0, 1, ?, 'system:better-auth-registration', ?, ?
        FROM auth_user AS auth
        WHERE auth.id = ? AND auth.emailVerified = 1 AND lower(trim(auth.email)) = ?
          AND (SELECT COUNT(*) FROM auth_account AS account
               WHERE account.userId = auth.id AND account.providerId = 'github') = 1
          AND EXISTS (
            SELECT 1 FROM auth_account AS account
            WHERE account.userId = auth.id AND account.providerId = 'github'
              AND account.accountId = ? AND account.accountId GLOB '[0-9]*'
              AND account.accountId NOT GLOB '*[^0-9]*'
          )
          AND NOT EXISTS (SELECT 1 FROM verified_identity_claims WHERE normalized_email = ?)
          AND NOT EXISTS (SELECT 1 FROM identity_subject_states WHERE normalized_email = ?)
          AND NOT EXISTS (
            SELECT 1 FROM users
            WHERE idp_email_verified = 1 AND lower(trim(idp_email)) = ?
          )
      `).bind(
        linksimUserId, email, email, now, now, now,
        input.authUserId, email, auth.account_id, email, email, email,
      ),
      db.prepare(`INSERT INTO verified_identity_claims
        (normalized_email, current_user_id, status, created_at, updated_at)
        SELECT ?, ?, 'active', ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
      `).bind(email, linksimUserId, now, now, linksimUserId),
      db.prepare(`INSERT INTO identity_subject_states
        (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at)
        SELECT ?, ?, 'current', ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
      `).bind(linksimUserId, email, linksimUserId, now, now, linksimUserId),
      db.prepare(`INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
      `).bind(input.authUserId, linksimUserId, now, linksimUserId),
      db.prepare(`INSERT INTO user_identity_audit
        (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
        SELECT 'better_auth_registration', ?, NULL, NULL, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM auth_identity_map WHERE auth_user_id = ? AND linksim_user_id = ?)
      `).bind(
        linksimUserId, email, JSON.stringify({ provider: "github", authUserId: input.authUserId }), now,
        input.authUserId, linksimUserId,
      ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      throw new AuthIdentityProvisionError("PROVISION_FAILED");
    }
    return { authUserId: input.authUserId, linksimUserId, created: true, kind: "registration" };
  } catch (error) {
    const winner = await currentProvisionedIdentity(db, input.authUserId);
    if (winner) return winner;
    if (error instanceof AuthIdentityProvisionError) throw error;
    throw new AuthIdentityProvisionError("PROVISION_FAILED");
  }
}

type MappingRow = {
  auth_user_id: string;
  linksim_user_id: string;
};

const publicMapping = (row: MappingRow | null) => row ? {
  authUserId: row.auth_user_id,
  linksimUserId: row.linksim_user_id,
} : null;

export async function findAuthIdentityByAuthUserId(db: D1Database, authUserId: string) {
  const row = await db.prepare(`
    SELECT auth_user_id, linksim_user_id
    FROM auth_identity_map
    WHERE auth_user_id = ?
  `).bind(authUserId).first<MappingRow>();
  return publicMapping(row);
}

export async function findAuthIdentityByLinkSimUserId(db: D1Database, linksimUserId: string) {
  const row = await db.prepare(`
    SELECT auth_user_id, linksim_user_id
    FROM auth_identity_map
    WHERE linksim_user_id = ?
  `).bind(linksimUserId).first<MappingRow>();
  return publicMapping(row);
}

export async function resolveCurrentAuthIdentity(db: D1Database, authUserId: string) {
  const row = await db.prepare(`
    SELECT mapping.auth_user_id, mapping.linksim_user_id
    FROM auth_identity_map AS mapping
    JOIN auth_user AS auth_user ON auth_user.id = mapping.auth_user_id
    JOIN users AS link_user ON link_user.id = mapping.linksim_user_id
    LEFT JOIN deleted_users AS deleted ON deleted.id = link_user.id
    LEFT JOIN identity_subject_states AS state ON state.user_id = link_user.id
    WHERE mapping.auth_user_id = ?
      AND deleted.id IS NULL
      AND (state.user_id IS NULL OR state.status = 'current')
      AND (link_user.is_admin = 1 OR link_user.is_moderator = 1 OR link_user.is_approved = 1)
    LIMIT 1
  `).bind(authUserId).first<MappingRow>();
  return publicMapping(row);
}

export async function resolveMappedAuthIdentityByVerifiedEmail(
  db: D1Database,
  verifiedEmail: string,
): Promise<{ linksimUserId: string } | null> {
  const email = normalizedEmail(verifiedEmail);
  if (!email.includes("@")) return null;
  const row = await db.prepare(`
    SELECT claim.current_user_id, claim.status AS claim_status,
      mapping.auth_user_id, mapping.linksim_user_id,
      user.id AS user_id, user.idp_email, user.idp_email_verified,
      user.is_admin, user.is_moderator, user.is_approved,
      deleted.id AS deleted_id, state.status AS subject_status,
      state.normalized_email AS subject_email, state.canonical_user_id
    FROM verified_identity_claims AS claim
    LEFT JOIN auth_identity_map AS mapping ON mapping.linksim_user_id = claim.current_user_id
    LEFT JOIN users AS user ON user.id = claim.current_user_id
    LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
    LEFT JOIN identity_subject_states AS state ON state.user_id = user.id
    WHERE claim.normalized_email = ?
  `).bind(email).first<{
    current_user_id: string;
    claim_status: string;
    auth_user_id: string | null;
    linksim_user_id: string | null;
    user_id: string | null;
    idp_email: string | null;
    idp_email_verified: number | null;
    is_admin: number | null;
    is_moderator: number | null;
    is_approved: number | null;
    deleted_id: string | null;
    subject_status: string | null;
    subject_email: string | null;
    canonical_user_id: string | null;
  }>();
  if (!row?.auth_user_id) return null;
  const eligible = row.claim_status === "active"
    && row.linksim_user_id === row.current_user_id
    && row.user_id === row.current_user_id
    && !row.deleted_id
    && row.idp_email_verified === 1
    && normalizedEmail(row.idp_email ?? "") === email
    && row.subject_status === "current"
    && normalizedEmail(row.subject_email ?? "") === email
    && row.canonical_user_id === row.user_id
    && (row.is_admin === 1 || row.is_moderator === 1 || row.is_approved === 1);
  if (!eligible) throw new AuthIdentityMapEligibilityError("LINKSIM_USER_INELIGIBLE");
  return { linksimUserId: row.current_user_id };
}

export async function attachAuthIdentity(
  db: D1Database,
  authUserId: string,
  linksimUserId: string,
  createdAt = new Date().toISOString(),
) {
  const inserted = await db.prepare(`
    INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
    SELECT ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM auth_user WHERE id = ?)
      AND EXISTS (
        SELECT 1
        FROM users AS u
        LEFT JOIN deleted_users AS d ON d.id = u.id
        LEFT JOIN identity_subject_states AS state ON state.user_id = u.id
        WHERE u.id = ?
          AND d.id IS NULL
          AND (state.user_id IS NULL OR state.status = 'current')
      )
    ON CONFLICT DO NOTHING
    RETURNING auth_user_id, linksim_user_id
  `).bind(authUserId, linksimUserId, createdAt, authUserId, linksimUserId)
    .first<MappingRow>();

  if (inserted) {
    return { authUserId, linksimUserId, created: true as const };
  }

  const existing = await db.prepare(`
    SELECT auth_user_id, linksim_user_id
    FROM auth_identity_map
    WHERE auth_user_id = ? OR linksim_user_id = ?
  `).bind(authUserId, linksimUserId).all<MappingRow>();
  const same = existing.results.find(row =>
    row.auth_user_id === authUserId && row.linksim_user_id === linksimUserId);
  if (same) return { authUserId, linksimUserId, created: false as const };
  if (existing.results.some(row => row.auth_user_id === authUserId)) {
    throw new AuthIdentityMapConflictError("AUTH_USER_ALREADY_MAPPED");
  }
  if (existing.results.some(row => row.linksim_user_id === linksimUserId)) {
    throw new AuthIdentityMapConflictError("LINKSIM_USER_ALREADY_MAPPED");
  }

  const eligibility = await db.prepare(`
    SELECT
      EXISTS (SELECT 1 FROM auth_user WHERE id = ?) AS auth_exists,
      EXISTS (SELECT 1 FROM users WHERE id = ?) AS linksim_exists,
      EXISTS (
        SELECT 1
        FROM users AS u
        LEFT JOIN deleted_users AS d ON d.id = u.id
        LEFT JOIN identity_subject_states AS state ON state.user_id = u.id
        WHERE u.id = ?
          AND d.id IS NULL
          AND (state.user_id IS NULL OR state.status = 'current')
      ) AS linksim_eligible
  `).bind(authUserId, linksimUserId, linksimUserId).first<{
    auth_exists: number;
    linksim_exists: number;
    linksim_eligible: number;
  }>();
  if (!eligibility?.auth_exists) {
    throw new AuthIdentityMapEligibilityError("AUTH_USER_NOT_FOUND");
  }
  if (!eligibility.linksim_exists) {
    throw new AuthIdentityMapEligibilityError("LINKSIM_USER_NOT_FOUND");
  }
  throw new AuthIdentityMapEligibilityError("LINKSIM_USER_INELIGIBLE");
}

type MigrationAttemptRow = {
  id: string;
  legacy_user_id: string;
  auth_user_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  completion_token: string | null;
};

const readMigrationAttempt = async (db: D1Database, attemptId: string) =>
  db.prepare(`SELECT id, legacy_user_id, auth_user_id, expires_at, consumed_at, completion_token
    FROM auth_migration_attempt WHERE id = ?`).bind(attemptId).first<MigrationAttemptRow>();

const attemptStateError = (row: MigrationAttemptRow | null, now: string) => {
  if (!row) return new LegacyAuthMigrationError("ATTEMPT_NOT_FOUND");
  if (row.consumed_at) return new LegacyAuthMigrationError("ATTEMPT_CONSUMED");
  if (row.expires_at <= now) return new LegacyAuthMigrationError("ATTEMPT_EXPIRED");
  return null;
};

export async function createLegacyAuthMigrationAttempt(
  db: D1Database,
  input: {
    attemptId: string;
    legacyUserId: string;
    accessSubject: string;
    accessIssuedAt: string;
    now: string;
    expiresAt: string;
  },
) {
  const result = await db.prepare(`
    INSERT INTO auth_migration_attempt
      (id, legacy_user_id, access_subject, access_issued_at, created_at, expires_at)
    SELECT ?, user.id, ?, ?, ?, ?
    FROM users AS user
    JOIN identity_subject_states AS state ON state.user_id = user.id
    LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
    WHERE user.id = ? AND ? = user.id
      AND deleted.id IS NULL
      AND state.status = 'current' AND state.canonical_user_id = user.id
      AND (user.is_admin = 1 OR user.is_moderator = 1 OR user.is_approved = 1)
      AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
      AND ? < ?
  `).bind(
    input.attemptId, input.accessSubject, input.accessIssuedAt, input.now, input.expiresAt,
    input.legacyUserId, input.accessSubject, input.now, input.expiresAt,
  ).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new LegacyAuthMigrationError("LEGACY_IDENTITY_INELIGIBLE");
  }
  return { attemptId: input.attemptId, expiresAt: input.expiresAt };
}

export async function isPendingLegacyAuthMigrationAttempt(
  db: D1Database,
  attemptId: string,
  now = new Date().toISOString(),
) {
  const row = await readMigrationAttempt(db, attemptId);
  return !attemptStateError(row, now);
}

type PrivilegedPasskeyRecoveryRow = {
  attempt_id: string;
  linksim_user_id: string;
  auth_user_id: string | null;
  attempt_auth_user_id: string | null;
  attempt_expires_at: string;
  authorization_expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

const readPrivilegedPasskeyRecovery = async (db: D1Database, attemptId: string) =>
  db.prepare(`
    SELECT attempt.id AS attempt_id, recovery.linksim_user_id,
      recovery.auth_user_id, attempt.auth_user_id AS attempt_auth_user_id,
      attempt.expires_at AS attempt_expires_at,
      recovery.expires_at AS authorization_expires_at,
      recovery.consumed_at, recovery.revoked_at
    FROM auth_privileged_passkey_recovery AS recovery
    JOIN auth_migration_attempt AS attempt
      ON attempt.id = recovery.migration_attempt_id
      AND attempt.legacy_user_id = recovery.linksim_user_id
      AND attempt.access_subject = recovery.expected_access_subject
    JOIN users AS user ON user.id = recovery.linksim_user_id
    JOIN identity_subject_states AS state ON state.user_id = user.id
    LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
    WHERE attempt.id = ?
      AND recovery.expected_access_subject = recovery.linksim_user_id
      AND deleted.id IS NULL
      AND state.status = 'current' AND state.canonical_user_id = user.id
      AND (user.is_admin = 1 OR user.is_moderator = 1)
      AND user.is_approved = 1
      AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
  `).bind(attemptId).first<PrivilegedPasskeyRecoveryRow>();

export async function claimPrivilegedPasskeyRecovery(
  db: D1Database,
  input: { attemptId: string; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  const row = await db.prepare(`
    UPDATE auth_privileged_passkey_recovery
    SET migration_attempt_id = ?, started_at = COALESCE(started_at, ?)
    WHERE id = (
      SELECT recovery.id
      FROM auth_privileged_passkey_recovery AS recovery
      JOIN auth_migration_attempt AS attempt
        ON attempt.id = ?
        AND attempt.legacy_user_id = recovery.linksim_user_id
        AND attempt.access_subject = recovery.expected_access_subject
      JOIN users AS user ON user.id = recovery.linksim_user_id
      JOIN identity_subject_states AS state ON state.user_id = user.id
      LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
      LEFT JOIN auth_identity_map AS mapping ON mapping.linksim_user_id = user.id
      WHERE recovery.migration_attempt_id IS NULL
        AND recovery.expected_access_subject = recovery.linksim_user_id
        AND recovery.consumed_at IS NULL AND recovery.revoked_at IS NULL
        AND recovery.expires_at > ? AND attempt.expires_at > ?
        AND deleted.id IS NULL AND mapping.linksim_user_id IS NULL
        AND state.status = 'current' AND state.canonical_user_id = user.id
        AND (user.is_admin = 1 OR user.is_moderator = 1)
        AND user.is_approved = 1
        AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
      ORDER BY recovery.created_at DESC
      LIMIT 1
    )
    RETURNING linksim_user_id
  `).bind(input.attemptId, now, input.attemptId, now, now)
    .first<{ linksim_user_id: string }>();
  if (!row) throw new LegacyAuthMigrationError("LEGACY_IDENTITY_INELIGIBLE");
  return { attemptId: input.attemptId, linksimUserId: row.linksim_user_id };
}

export async function resolvePrivilegedPasskeyRecovery(
  db: D1Database,
  attemptId: string,
  now = new Date().toISOString(),
) {
  const row = await readPrivilegedPasskeyRecovery(db, attemptId);
  if (!row || row.revoked_at) throw new LegacyAuthMigrationError("LEGACY_IDENTITY_INELIGIBLE");
  if (row.attempt_expires_at <= now || row.authorization_expires_at <= now) {
    throw new LegacyAuthMigrationError("ATTEMPT_EXPIRED");
  }
  if (row.auth_user_id && row.attempt_auth_user_id && row.auth_user_id !== row.attempt_auth_user_id) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }
  return {
    attemptId,
    linksimUserId: row.linksim_user_id,
    authUserId: row.auth_user_id ?? row.attempt_auth_user_id,
    consumed: Boolean(row.consumed_at),
  };
}

export async function resolvePendingPrivilegedPasskeyRecovery(
  db: D1Database,
  attemptId: string,
  now = new Date().toISOString(),
) {
  const recovery = await resolvePrivilegedPasskeyRecovery(db, attemptId, now);
  if (recovery.consumed) throw new LegacyAuthMigrationError("ATTEMPT_CONSUMED");
  return recovery;
}

export async function resolvePendingPrivilegedPasskeyRecoveryForAuthUser(
  db: D1Database,
  authUserId: string,
  now = new Date().toISOString(),
) {
  const row = await db.prepare(`SELECT migration_attempt_id
    FROM auth_privileged_passkey_recovery
    WHERE auth_user_id = ? AND migration_attempt_id IS NOT NULL
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    LIMIT 1`).bind(authUserId, now).first<{ migration_attempt_id: string }>();
  if (!row) return null;
  return resolvePendingPrivilegedPasskeyRecovery(db, row.migration_attempt_id, now);
}

export async function canDeletePasskeyWithoutLockout(
  db: D1Database,
  authUserId: string,
) {
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM auth_account WHERE userId = ?) AS account_count,
      (SELECT COUNT(*) FROM auth_passkey WHERE userId = ?) AS passkey_count`)
    .bind(authUserId, authUserId)
    .first<{ account_count: number; passkey_count: number }>();
  return Number(row?.account_count ?? 0) > 0 || Number(row?.passkey_count ?? 0) > 1;
}

export async function bindPrivilegedPasskeyRecoveryUser(
  db: D1Database,
  input: { attemptId: string; authUserId: string; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  const recovery = await resolvePrivilegedPasskeyRecovery(db, input.attemptId, now);
  if (recovery.authUserId && recovery.authUserId !== input.authUserId) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }
  if (recovery.consumed) {
    const mapped = await findAuthIdentityByAuthUserId(db, input.authUserId);
    if (mapped?.linksimUserId === recovery.linksimUserId) return { ...recovery, authUserId: input.authUserId };
    throw new LegacyAuthMigrationError("ATTEMPT_CONSUMED");
  }
  const conflict = await db.prepare(`SELECT auth_user_id, linksim_user_id FROM auth_identity_map
    WHERE auth_user_id = ? OR linksim_user_id = ?`).bind(input.authUserId, recovery.linksimUserId).all<MappingRow>();
  if (conflict.results.length) throw new LegacyAuthMigrationError("IDENTITY_CONFLICT");
  const results = await db.batch([
    db.prepare(`UPDATE auth_privileged_passkey_recovery SET auth_user_id = ?
      WHERE migration_attempt_id = ? AND consumed_at IS NULL AND revoked_at IS NULL
        AND expires_at > ? AND (auth_user_id IS NULL OR auth_user_id = ?)
        AND EXISTS (SELECT 1 FROM auth_user WHERE id = ?)`)
      .bind(input.authUserId, input.attemptId, now, input.authUserId, input.authUserId),
    db.prepare(`UPDATE auth_migration_attempt SET auth_user_id = ?
      WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
        AND (auth_user_id IS NULL OR auth_user_id = ?)`)
      .bind(input.authUserId, input.attemptId, now, input.authUserId),
  ]);
  if (results.some(result => (result.meta?.changes ?? 0) !== 1)) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }
  return { attemptId: input.attemptId, authUserId: input.authUserId, linksimUserId: recovery.linksimUserId };
}

export async function completePrivilegedPasskeyRecovery(
  db: D1Database,
  input: { attemptId: string; authUserId: string; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  const recovery = await resolvePrivilegedPasskeyRecovery(db, input.attemptId, now);
  if (recovery.authUserId !== input.authUserId) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }
  const existing = await db.prepare(`SELECT auth_user_id, linksim_user_id FROM auth_identity_map
    WHERE auth_user_id = ? OR linksim_user_id = ?`).bind(input.authUserId, recovery.linksimUserId).all<MappingRow>();
  const exact = existing.results.some(row => row.auth_user_id === input.authUserId
    && row.linksim_user_id === recovery.linksimUserId);
  if (existing.results.some(row => row.auth_user_id !== input.authUserId
    || row.linksim_user_id !== recovery.linksimUserId)) {
    throw new LegacyAuthMigrationError("IDENTITY_CONFLICT");
  }
  if (recovery.consumed && exact) {
    return { authUserId: input.authUserId, linksimUserId: recovery.linksimUserId };
  }
  const completionToken = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
      SELECT ?, recovery.linksim_user_id, ?
      FROM auth_privileged_passkey_recovery AS recovery
      JOIN auth_user AS auth ON auth.id = recovery.auth_user_id
      WHERE recovery.migration_attempt_id = ? AND recovery.auth_user_id = ?
        AND recovery.consumed_at IS NULL AND recovery.revoked_at IS NULL
        AND recovery.expires_at > ?`)
      .bind(input.authUserId, now, input.attemptId, input.authUserId, now),
    db.prepare(`UPDATE auth_privileged_passkey_recovery SET consumed_at = ?
      WHERE migration_attempt_id = ? AND auth_user_id = ?
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
        AND EXISTS (SELECT 1 FROM auth_identity_map
          WHERE auth_user_id = ? AND linksim_user_id = auth_privileged_passkey_recovery.linksim_user_id)`)
      .bind(now, input.attemptId, input.authUserId, now, input.authUserId),
    db.prepare(`UPDATE auth_migration_attempt SET consumed_at = ?, completion_token = ?
      WHERE id = ? AND auth_user_id = ? AND consumed_at IS NULL AND expires_at > ?`)
      .bind(now, completionToken, input.attemptId, input.authUserId, now),
    db.prepare(`INSERT INTO user_identity_audit
      (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
      SELECT 'better_auth_privileged_passkey_recovery', recovery.linksim_user_id, NULL,
        recovery.linksim_user_id, NULL, ?, ?
      FROM auth_privileged_passkey_recovery AS recovery
      WHERE recovery.migration_attempt_id = ? AND recovery.auth_user_id = ?
        AND recovery.consumed_at = ?
        AND NOT EXISTS (SELECT 1 FROM user_identity_audit
          WHERE event_type = 'better_auth_privileged_passkey_recovery'
            AND target_user_id = recovery.linksim_user_id)`)
      .bind(JSON.stringify({ attemptId: input.attemptId, authUserId: input.authUserId, provider: "passkey" }),
        now, input.attemptId, input.authUserId, now),
  ]);
  if ((results[1].meta?.changes ?? 0) !== 1
    || (results[2].meta?.changes ?? 0) !== 1
    || (results[3].meta?.changes ?? 0) !== 1) {
    throw new LegacyAuthMigrationError("MIGRATION_FAILED");
  }
  return { authUserId: input.authUserId, linksimUserId: recovery.linksimUserId };
}

export async function bindLegacyAuthMigrationAttempt(
  db: D1Database,
  attemptId: string,
  authUserId: string,
  now = new Date().toISOString(),
) {
  const result = await db.prepare(`
    UPDATE auth_migration_attempt
    SET auth_user_id = ?
    WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
      AND (auth_user_id IS NULL OR auth_user_id = ?)
      AND EXISTS (
        SELECT 1 FROM auth_user AS auth
        JOIN auth_account AS account ON account.userId = auth.id
        WHERE auth.id = ? AND auth.emailVerified = 1
          AND account.providerId = 'github'
          AND account.accountId GLOB '[0-9]*'
          AND account.accountId NOT GLOB '*[^0-9]*'
      )
  `).bind(authUserId, attemptId, now, authUserId, authUserId).run();
  if ((result.meta?.changes ?? 0) === 1) return { attemptId, authUserId };
  const row = await readMigrationAttempt(db, attemptId);
  const stateError = attemptStateError(row, now);
  if (stateError) throw stateError;
  if (row?.auth_user_id && row.auth_user_id !== authUserId) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }
  throw new LegacyAuthMigrationError("AUTH_IDENTITY_INELIGIBLE");
}

export async function completeLegacyAuthMigrationAttempt(
  db: D1Database,
  input: { attemptId: string; authUserId: string; now?: string; completionToken?: string },
) {
  const now = input.now ?? new Date().toISOString();
  const completionToken = input.completionToken ?? crypto.randomUUID();
  const attempt = await readMigrationAttempt(db, input.attemptId);
  const stateError = attemptStateError(attempt, now);
  if (stateError) throw stateError;
  if (attempt?.auth_user_id !== input.authUserId) {
    throw new LegacyAuthMigrationError("ATTEMPT_IDENTITY_MISMATCH");
  }

  const existing = await db.prepare(`SELECT auth_user_id, linksim_user_id
    FROM auth_identity_map WHERE auth_user_id = ? OR linksim_user_id = ?`)
    .bind(input.authUserId, attempt.legacy_user_id).all<MappingRow>();
  if (existing.results.some(row =>
    row.auth_user_id !== input.authUserId || row.linksim_user_id !== attempt.legacy_user_id
  )) throw new LegacyAuthMigrationError("IDENTITY_CONFLICT");

  try {
    const results = await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
        SELECT attempt.auth_user_id, attempt.legacy_user_id, ?
        FROM auth_migration_attempt AS attempt
        JOIN auth_user AS auth ON auth.id = attempt.auth_user_id
        JOIN auth_account AS account ON account.userId = auth.id
        JOIN users AS user ON user.id = attempt.legacy_user_id
        JOIN identity_subject_states AS state ON state.user_id = user.id
        LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
        WHERE attempt.id = ? AND attempt.auth_user_id = ?
          AND attempt.consumed_at IS NULL
          AND attempt.expires_at > ? AND attempt.access_subject = attempt.legacy_user_id
          AND deleted.id IS NULL
          AND state.status = 'current' AND state.canonical_user_id = user.id
          AND (user.is_admin = 1 OR user.is_moderator = 1 OR user.is_approved = 1)
          AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
          AND auth.emailVerified = 1 AND account.providerId = 'github'
          AND account.accountId GLOB '[0-9]*'
          AND account.accountId NOT GLOB '*[^0-9]*'
      `).bind(now, input.attemptId, input.authUserId, now),
      db.prepare(`UPDATE auth_migration_attempt SET consumed_at = ?, completion_token = ?
        WHERE id = ? AND auth_user_id = ? AND consumed_at IS NULL
          AND expires_at > ?
          AND access_subject = legacy_user_id
          AND EXISTS (
            SELECT 1 FROM auth_identity_map AS mapping
            JOIN auth_user AS auth ON auth.id = mapping.auth_user_id
            JOIN auth_account AS account ON account.userId = auth.id
            JOIN users AS user ON user.id = mapping.linksim_user_id
            JOIN identity_subject_states AS state ON state.user_id = user.id
            LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
            WHERE mapping.auth_user_id = ? AND mapping.linksim_user_id = legacy_user_id
              AND deleted.id IS NULL
              AND state.status = 'current' AND state.canonical_user_id = user.id
              AND (user.is_admin = 1 OR user.is_moderator = 1 OR user.is_approved = 1)
              AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
              AND auth.emailVerified = 1 AND account.providerId = 'github'
              AND account.accountId GLOB '[0-9]*'
              AND account.accountId NOT GLOB '*[^0-9]*'
          )`)
        .bind(now, completionToken, input.attemptId, input.authUserId, now, input.authUserId),
      db.prepare(`INSERT INTO user_identity_audit
        (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
        SELECT 'better_auth_dual_login', legacy_user_id, NULL, legacy_user_id, NULL, ?, ?
        FROM auth_migration_attempt
        WHERE id = ? AND auth_user_id = ? AND completion_token = ?`)
        .bind(JSON.stringify({ attemptId: input.attemptId, authUserId: input.authUserId, provider: "github" }),
          now, input.attemptId, input.authUserId, completionToken),
    ]);
    const mappingChanges = results[0].meta?.changes ?? 0;
    if (
      (mappingChanges !== 0 && mappingChanges !== 1)
      || (results[1].meta?.changes ?? 0) !== 1
      || (results[2].meta?.changes ?? 0) !== 1
    ) {
      const current = await db.prepare(`SELECT auth_user_id, linksim_user_id
        FROM auth_identity_map WHERE auth_user_id = ? OR linksim_user_id = ?`)
        .bind(input.authUserId, attempt.legacy_user_id).all<MappingRow>();
      if (current.results.some(row =>
        row.auth_user_id !== input.authUserId || row.linksim_user_id !== attempt.legacy_user_id
      )) throw new LegacyAuthMigrationError("IDENTITY_CONFLICT");
      throw new LegacyAuthMigrationError("LEGACY_IDENTITY_INELIGIBLE");
    }
    return { authUserId: input.authUserId, linksimUserId: attempt.legacy_user_id };
  } catch (error) {
    if (error instanceof LegacyAuthMigrationError) throw error;
    const current = await db.prepare(`SELECT auth_user_id, linksim_user_id
      FROM auth_identity_map WHERE auth_user_id = ? OR linksim_user_id = ?`)
      .bind(input.authUserId, attempt.legacy_user_id).all<MappingRow>();
    const conflict = current.results.some(row =>
      row.auth_user_id !== input.authUserId || row.linksim_user_id !== attempt.legacy_user_id
    );
    throw new LegacyAuthMigrationError(conflict ? "IDENTITY_CONFLICT" : "MIGRATION_FAILED");
  }
}

export async function resolveCompletedLegacyAuthMigrationAttempt(
  db: D1Database,
  input: { attemptId: string; authUserId: string },
) {
  const row = await db.prepare(`
    SELECT attempt.auth_user_id, attempt.legacy_user_id AS linksim_user_id
    FROM auth_migration_attempt AS attempt
    JOIN auth_identity_map AS mapping
      ON mapping.auth_user_id = attempt.auth_user_id
      AND mapping.linksim_user_id = attempt.legacy_user_id
    JOIN auth_user AS auth ON auth.id = mapping.auth_user_id
    JOIN auth_account AS account ON account.userId = auth.id
    JOIN users AS user ON user.id = mapping.linksim_user_id
    JOIN identity_subject_states AS state ON state.user_id = user.id
    LEFT JOIN deleted_users AS deleted ON deleted.id = user.id
    WHERE attempt.id = ? AND attempt.auth_user_id = ?
      AND attempt.consumed_at IS NOT NULL AND attempt.completion_token IS NOT NULL
      AND attempt.access_subject = attempt.legacy_user_id
      AND deleted.id IS NULL
      AND state.status = 'current' AND state.canonical_user_id = user.id
      AND (user.is_admin = 1 OR user.is_moderator = 1 OR user.is_approved = 1)
      AND COALESCE(user.approved_by_user_id, '') NOT LIKE 'revoked:%'
      AND auth.emailVerified = 1 AND account.providerId = 'github'
      AND account.accountId GLOB '[0-9]*'
      AND account.accountId NOT GLOB '*[^0-9]*'
    LIMIT 1
  `).bind(input.attemptId, input.authUserId).first<MappingRow>();
  return publicMapping(row);
}
