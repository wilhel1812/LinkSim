#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
# Fixed targets prevent environment overrides from turning a refresh into a production import.
[[ "${PROD_DB_NAME:-linksim}" == "linksim" && "${STAGING_DB_NAME:-linksim_staging}" == "linksim_staging" ]] || { echo 'Unexpected refresh targets' >&2; exit 1; }
[[ "${ANONYMIZE_STAGING:-1}" == "1" ]] || { echo 'Unsanitized staging imports are disabled' >&2; exit 1; }
REFRESH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linksim-staging-export.XXXXXX")"
trap 'rm -rf -- "${REFRESH_DIR}"' EXIT
INVENTORY_SQL="SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
npx wrangler d1 execute linksim --config wrangler.toml --remote --command "${INVENTORY_SQL}" --json > "${REFRESH_DIR}/source.json"
npx wrangler d1 execute linksim_staging --config wrangler.staging.toml --remote --command "${INVENTORY_SQL}" --json > "${REFRESH_DIR}/target.json"
node scripts/staging-export.mjs tables "${REFRESH_DIR}/source.json" > "${REFRESH_DIR}/tables.txt"
node scripts/staging-export.mjs tables "${REFRESH_DIR}/target.json" target > /dev/null
TABLE_ARGS=()
while IFS= read -r table; do TABLE_ARGS+=(--table "${table}"); done < "${REFRESH_DIR}/tables.txt"
# Auth tables are never included in this export, even in the private temporary directory.
npx wrangler d1 export linksim --config wrangler.toml --remote "${TABLE_ARGS[@]}" --output "${REFRESH_DIR}/application.sql"
node scripts/staging-export.mjs sanitize "${REFRESH_DIR}/application.sql" "${REFRESH_DIR}/sanitized.sql"
npx wrangler d1 execute linksim_staging --config wrangler.staging.toml --remote --file "${REFRESH_DIR}/sanitized.sql" --yes
echo '[staging-refresh:d1] Sanitized application refresh complete; temporary files removed on exit.'
