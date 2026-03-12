#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT_DIR="${ROOT_DIR}/.tmp/staging-refresh"
PROD_DB_NAME="${PROD_DB_NAME:-linksim}"
STAGING_DB_NAME="${STAGING_DB_NAME:-linksim_staging}"

mkdir -p "${EXPORT_DIR}"
STAMP="$(date +"%Y%m%d-%H%M%S")"
DUMP_FILE="${EXPORT_DIR}/d1-prod-${STAMP}.sql"

cd "${ROOT_DIR}"

echo "[staging-refresh:d1] Exporting prod DB '${PROD_DB_NAME}' to ${DUMP_FILE}"
npx wrangler d1 export "${PROD_DB_NAME}" --remote --output "${DUMP_FILE}"

echo "[staging-refresh:d1] Importing dump into staging DB '${STAGING_DB_NAME}'"
npx wrangler d1 execute "${STAGING_DB_NAME}" --remote --file "${DUMP_FILE}" --yes

echo "[staging-refresh:d1] Complete"
echo "[staging-refresh:d1] Snapshot: ${DUMP_FILE}"
