#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT_DIR="${ROOT_DIR}/.tmp/staging-refresh"
PROD_DB_NAME="${PROD_DB_NAME:-linksim}"
STAGING_DB_NAME="${STAGING_DB_NAME:-linksim_staging}"
ANONYMIZE_STAGING="${ANONYMIZE_STAGING:-1}"

mkdir -p "${EXPORT_DIR}"
STAMP="$(date +"%Y%m%d-%H%M%S")"
DUMP_FILE="${EXPORT_DIR}/d1-prod-${STAMP}.sql"

cd "${ROOT_DIR}"

echo "[staging-refresh:d1] Exporting prod DB '${PROD_DB_NAME}' to ${DUMP_FILE}"
npx wrangler d1 export "${PROD_DB_NAME}" --remote --output "${DUMP_FILE}"

echo "[staging-refresh:d1] Importing dump into staging DB '${STAGING_DB_NAME}'"
npx wrangler d1 execute "${STAGING_DB_NAME}" --remote --file "${DUMP_FILE}" --yes

if [[ "${ANONYMIZE_STAGING}" == "1" ]]; then
  ANON_SQL="${EXPORT_DIR}/staging-anonymize-${STAMP}.sql"
  cat > "${ANON_SQL}" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_identity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  source_user_id TEXT,
  actor_user_id TEXT,
  idp_email TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

UPDATE users
SET
  username = COALESCE(NULLIF(TRIM(username), ''), 'user') || '-staging',
  email = CASE
    WHEN email IS NULL OR TRIM(email) = '' THEN email
    ELSE 'staging+' || substr(id, 1, 8) || '@example.invalid'
  END,
  bio = '',
  access_request_note = '',
  idp_email = CASE
    WHEN idp_email IS NULL OR TRIM(idp_email) = '' THEN idp_email
    ELSE 'staging+' || substr(id, 1, 8) || '@example.invalid'
  END,
  avatar_url = NULL,
  avatar_object_key = NULL,
  avatar_thumb_key = NULL,
  avatar_hash = NULL,
  avatar_bytes = NULL,
  avatar_content_type = NULL,
  updated_at = datetime('now');

UPDATE user_identity_audit
SET
  idp_email = CASE
    WHEN idp_email IS NULL OR TRIM(idp_email) = '' THEN idp_email
    ELSE 'staging+audit@example.invalid'
  END,
  details_json = NULL;
SQL
  echo "[staging-refresh:d1] Applying staging anonymization (ANONYMIZE_STAGING=1)"
  npx wrangler d1 execute "${STAGING_DB_NAME}" --remote --file "${ANON_SQL}" --yes
else
  echo "[staging-refresh:d1] Anonymization skipped (ANONYMIZE_STAGING=${ANONYMIZE_STAGING})"
fi

echo "[staging-refresh:d1] Complete"
echo "[staging-refresh:d1] Snapshot: ${DUMP_FILE}"
