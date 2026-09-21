export type AuthAssistedRecoveryCode =
  | "ACTOR_FORBIDDEN"
  | "EVIDENCE_INSUFFICIENT"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_INELIGIBLE"
  | "RECOVERY_FAILED";

export class AuthAssistedRecoveryError extends Error {
  readonly name = "AuthAssistedRecoveryError";
  readonly code: AuthAssistedRecoveryCode;

  constructor(code: AuthAssistedRecoveryCode) {
    super(code);
    this.code = code;
  }
}

export type AuthRecoveryEvidenceType =
  | "account-history"
  | "provider-proof"
  | "resource-ownership"
  | "other";

const EVIDENCE_TYPES = new Set<AuthRecoveryEvidenceType>([
  "account-history",
  "provider-proof",
  "resource-ownership",
  "other",
]);

const CREDENTIAL_SHAPED_EVIDENCE = [
  /\b(?:bearer|token|secret|password|cookie|authorization|passkey)\b/iu,
  /\b(?:access|refresh|id|session|client)[_-]?token\b/iu,
  /\bclient[_-]?secret\b/iu,
  /\b(?:cf_authorization|better-auth\.session_token|credentialid|private[_ -]?key)\b/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/u,
  /\b[A-Za-z0-9_-]{48,}\b/u,
] as const;

const normalizedEvidence = (type: string, summary: string) => {
  const evidenceType = type.trim() as AuthRecoveryEvidenceType;
  const evidenceSummary = summary.trim();
  if (
    !EVIDENCE_TYPES.has(evidenceType)
    || evidenceSummary.length < 24
    || evidenceSummary.length > 1_000
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(evidenceSummary)
    || CREDENTIAL_SHAPED_EVIDENCE.some(pattern => pattern.test(evidenceSummary))
  ) throw new AuthAssistedRecoveryError("EVIDENCE_INSUFFICIENT");
  return { evidenceType, evidenceSummary };
};

export async function assistAuthIdentityRecovery(
  db: D1Database,
  input: {
    actorUserId: string;
    authUserId: string;
    linksimUserId: string;
    evidenceType: string;
    evidenceSummary: string;
    now?: string;
  },
) {
  const evidence = normalizedEvidence(input.evidenceType, input.evidenceSummary);
  const now = input.now ?? new Date().toISOString();
  const details = JSON.stringify({ authUserId: input.authUserId, ...evidence, outcome: "mapped" });

  try {
    const results = await db.batch([
      db.prepare(`
        INSERT INTO auth_identity_map (auth_user_id, linksim_user_id, created_at)
        SELECT auth.id, target.id, ?
        FROM auth_user AS auth
        JOIN users AS target ON target.id = ?
        JOIN identity_subject_states AS target_state ON target_state.user_id = target.id
        JOIN users AS actor ON actor.id = ?
        JOIN identity_subject_states AS actor_state ON actor_state.user_id = actor.id
        LEFT JOIN deleted_users AS target_deleted ON target_deleted.id = target.id
        LEFT JOIN deleted_users AS actor_deleted ON actor_deleted.id = actor.id
        WHERE auth.id = ? AND auth.emailVerified = 1
          AND EXISTS (
            SELECT 1 FROM auth_account AS account
            WHERE account.userId = auth.id AND account.providerId = 'github'
              AND account.accountId GLOB '[0-9]*'
              AND account.accountId NOT GLOB '*[^0-9]*'
          )
          AND target_deleted.id IS NULL
          AND target_state.status = 'current' AND target_state.canonical_user_id = target.id
          AND (target.is_admin = 1 OR target.is_moderator = 1 OR target.is_approved = 1)
          AND COALESCE(target.approved_by_user_id, '') NOT LIKE 'revoked:%'
          AND actor_deleted.id IS NULL AND actor.is_admin = 1 AND actor.is_approved = 1
          AND actor_state.status = 'current' AND actor_state.canonical_user_id = actor.id
          AND COALESCE(actor.approved_by_user_id, '') NOT LIKE 'revoked:%'
          AND NOT EXISTS (
            SELECT 1 FROM auth_identity_map AS existing
            WHERE existing.auth_user_id = auth.id OR existing.linksim_user_id = target.id
          )
      `).bind(now, input.linksimUserId, input.actorUserId, input.authUserId),
      db.prepare(`
        INSERT INTO user_identity_audit
          (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
        SELECT 'better_auth_assisted_recovery', mapping.linksim_user_id, NULL, ?, NULL, ?, ?
        FROM auth_identity_map AS mapping
        WHERE mapping.auth_user_id = ? AND mapping.linksim_user_id = ? AND mapping.created_at = ?
          AND NOT EXISTS (
            SELECT 1 FROM user_identity_audit AS prior
            WHERE prior.event_type = 'better_auth_assisted_recovery'
              AND prior.target_user_id = mapping.linksim_user_id
              AND json_extract(prior.details_json, '$.authUserId') = mapping.auth_user_id
          )
      `).bind(input.actorUserId, details, now, input.authUserId, input.linksimUserId, now),
    ]);
    if (results.every(result => (result.meta?.changes ?? 0) === 1)) {
      return { authUserId: input.authUserId, linksimUserId: input.linksimUserId };
    }
  } catch {
    const conflict = await db.prepare(`SELECT 1 AS found FROM auth_identity_map
      WHERE auth_user_id = ? OR linksim_user_id = ? LIMIT 1`)
      .bind(input.authUserId, input.linksimUserId).first<{ found: number }>();
    if (conflict) throw new AuthAssistedRecoveryError("IDENTITY_CONFLICT");
    throw new AuthAssistedRecoveryError("RECOVERY_FAILED");
  }

  const state = await db.prepare(`
    SELECT
      EXISTS (
        SELECT 1 FROM users AS actor
        JOIN identity_subject_states AS subject ON subject.user_id = actor.id
        LEFT JOIN deleted_users AS deleted ON deleted.id = actor.id
        WHERE actor.id = ? AND actor.is_admin = 1 AND actor.is_approved = 1
          AND deleted.id IS NULL AND subject.status = 'current'
          AND subject.canonical_user_id = actor.id
          AND COALESCE(actor.approved_by_user_id, '') NOT LIKE 'revoked:%'
      ) AS actor_ok,
      EXISTS (SELECT 1 FROM auth_identity_map WHERE auth_user_id = ? OR linksim_user_id = ?) AS conflict,
      EXISTS (
        SELECT 1 FROM auth_user AS auth
        JOIN users AS target ON target.id = ?
        JOIN identity_subject_states AS subject ON subject.user_id = target.id
        LEFT JOIN deleted_users AS deleted ON deleted.id = target.id
        WHERE auth.id = ? AND auth.emailVerified = 1
          AND deleted.id IS NULL AND subject.status = 'current'
          AND subject.canonical_user_id = target.id
          AND (target.is_admin = 1 OR target.is_moderator = 1 OR target.is_approved = 1)
          AND COALESCE(target.approved_by_user_id, '') NOT LIKE 'revoked:%'
          AND EXISTS (
            SELECT 1 FROM auth_account AS account
            WHERE account.userId = auth.id AND account.providerId = 'github'
              AND account.accountId GLOB '[0-9]*'
              AND account.accountId NOT GLOB '*[^0-9]*'
          )
      ) AS identity_ok
  `).bind(
    input.actorUserId,
    input.authUserId,
    input.linksimUserId,
    input.linksimUserId,
    input.authUserId,
  ).first<{ actor_ok: number; conflict: number; identity_ok: number }>();
  if (!state?.actor_ok) throw new AuthAssistedRecoveryError("ACTOR_FORBIDDEN");
  if (state.conflict) throw new AuthAssistedRecoveryError("IDENTITY_CONFLICT");
  if (!state.identity_ok) throw new AuthAssistedRecoveryError("IDENTITY_INELIGIBLE");
  throw new AuthAssistedRecoveryError("RECOVERY_FAILED");
}
