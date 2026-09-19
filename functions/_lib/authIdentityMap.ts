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
