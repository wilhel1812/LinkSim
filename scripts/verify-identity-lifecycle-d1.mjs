import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_VERSION = "2026-08-12-identity-lifecycle-v1";

export const parseWranglerRows = (stdout) => {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler D1 JSON output.");
  const payload = JSON.parse(stdout.slice(start, end + 1));
  const rows = payload.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
  if (rows.length === 0) throw new Error("D1 identity lifecycle probe returned no rows.");
  return rows;
};

const count = (row, field) => Number(row?.[field] ?? Number.NaN);

export const validateIdentityLifecycleProbe = (phase, row) => {
  const duplicateVerifiedEmails = count(row, "duplicate_verified_emails");
  if (!Number.isFinite(duplicateVerifiedEmails) || duplicateVerifiedEmails !== 0) {
    throw new Error(`Identity migration blocked: duplicate_verified_emails=${String(row?.duplicate_verified_emails)}`);
  }
  const unresolvedTombstones = count(row, "unresolved_tombstones");
  if (!Number.isFinite(unresolvedTombstones) || unresolvedTombstones !== 0) {
    throw new Error(`Identity migration blocked: unresolved_tombstones=${String(row?.unresolved_tombstones)}`);
  }
  if (phase === "pre") return;

  for (const field of ["missing_verified_claims", "missing_current_subjects", "invalid_active_claims", "unconsumed_existing_bootstraps"]) {
    const value = count(row, field);
    if (!Number.isFinite(value) || value !== 0) {
      throw new Error(`Identity migration verification failed: ${field}=${String(row?.[field])}`);
    }
  }
  if (row?.version !== EXPECTED_VERSION) {
    throw new Error(`Identity migration verification failed: version=${String(row?.version)}`);
  }
};

const PRE_SQL = `SELECT
  (SELECT COUNT(*) FROM deleted_users) AS unresolved_tombstones,
  (SELECT COUNT(*) FROM (
    SELECT lower(trim(idp_email))
    FROM users
    WHERE idp_email_verified = 1 AND COALESCE(trim(idp_email), '') <> ''
    GROUP BY lower(trim(idp_email)) HAVING COUNT(*) > 1
  )) AS duplicate_verified_emails;`;

const POST_SQL = `SELECT
  (SELECT COUNT(*) FROM (
    SELECT lower(trim(idp_email))
    FROM users
    WHERE idp_email_verified = 1 AND COALESCE(trim(idp_email), '') <> ''
    GROUP BY lower(trim(idp_email)) HAVING COUNT(*) > 1
  )) AS duplicate_verified_emails,
  (SELECT COUNT(*) FROM deleted_users d
    WHERE NOT EXISTS (
      SELECT 1 FROM identity_subject_states s
      WHERE s.user_id = d.id AND s.status = 'blocked'
    )
  ) AS unresolved_tombstones,
  (SELECT COUNT(*) FROM users u
    WHERE u.idp_email_verified = 1 AND COALESCE(trim(u.idp_email), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM verified_identity_claims c
        WHERE c.normalized_email = lower(trim(u.idp_email))
          AND c.current_user_id = u.id AND c.status = 'active'
      )
  ) AS missing_verified_claims,
  (SELECT COUNT(*) FROM users u
    WHERE u.idp_email_verified = 1 AND COALESCE(trim(u.idp_email), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM identity_subject_states s
        WHERE s.user_id = u.id AND s.status = 'current' AND s.canonical_user_id = u.id
      )
  ) AS missing_current_subjects,
  (SELECT COUNT(*) FROM verified_identity_claims c
    WHERE c.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM identity_subject_states s
      WHERE s.user_id = c.current_user_id AND s.status = 'current'
    )
  ) AS invalid_active_claims,
  (SELECT COUNT(*) FROM identity_subject_states s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'current' AND s.bootstrap_consumed <> 1
  ) AS unconsumed_existing_bootstraps,
  (SELECT version FROM identity_lifecycle_meta WHERE singleton = 1) AS version;`;

const run = (database, phase) => {
  if (!database || !["pre", "post"].includes(phase)) {
    throw new Error("Usage: node scripts/verify-identity-lifecycle-d1.mjs <database> <pre|post>");
  }
  const wrangler = path.join(process.cwd(), "node_modules", ".bin", "wrangler");
  const result = spawnSync(
    wrangler,
    ["d1", "execute", database, "--remote", "--json", "--command", phase === "pre" ? PRE_SQL : POST_SQL],
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Wrangler D1 probe failed.");
  const [row] = parseWranglerRows(result.stdout);
  validateIdentityLifecycleProbe(phase, row);
  console.log(`[identity-lifecycle] ${phase} probe passed for ${database}`);
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run(process.argv[2], process.argv[3]);
}
