#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <staging|prod>"
  exit 1
fi

ENV_NAME="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${ROOT_DIR}/environments/${ENV_NAME}"
IMPORTS_FILE="${ENV_DIR}/imports.env"

if [[ ! -d "${ENV_DIR}" ]]; then
  echo "Unknown environment: ${ENV_NAME}"
  exit 1
fi

if [[ ! -f "${IMPORTS_FILE}" ]]; then
  echo "Missing ${IMPORTS_FILE}. Copy imports.env.example -> imports.env and fill all IDs."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for JSON parsing in import.sh."
  exit 1
fi

decode_base64() {
  local input="$1"
  if base64 --help 2>/dev/null | grep -q -- "--decode"; then
    echo "${input}" | base64 --decode
  else
    echo "${input}" | base64 -D
  fi
}

source "${IMPORTS_FILE}"

required=(TF_ACCOUNT_ID TF_PROJECT_NAME TF_PROJECT_DOMAINS_CSV TF_D1_DATABASE_ID TF_R2_BUCKET_NAME TF_R2_BUCKET_JURISDICTION TF_ZONE_ID TF_DNS_RECORD_IMPORTS_JSON TF_ACCESS_POLICY_IMPORTS_JSON)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required value: ${name}"
    exit 1
  fi
done

"${ROOT_DIR}/scripts/init.sh" "${ENV_NAME}"

echo "[import] pages project"
terraform -chdir="${ENV_DIR}" import module.stack.cloudflare_pages_project.project "${TF_ACCOUNT_ID}/${TF_PROJECT_NAME}"

echo "[import] pages domains"
IFS=',' read -r -a domains <<<"${TF_PROJECT_DOMAINS_CSV}"
for domain in "${domains[@]}"; do
  trimmed="$(echo "${domain}" | xargs)"
  [[ -z "${trimmed}" ]] && continue
  terraform -chdir="${ENV_DIR}" import "module.stack.cloudflare_pages_domain.custom_domains[\"${trimmed}\"]" "${TF_ACCOUNT_ID}/${TF_PROJECT_NAME}/${trimmed}"
done

echo "[import] d1"
terraform -chdir="${ENV_DIR}" import module.stack.cloudflare_d1_database.database "${TF_ACCOUNT_ID}/${TF_D1_DATABASE_ID}"

echo "[import] r2"
terraform -chdir="${ENV_DIR}" import module.stack.cloudflare_r2_bucket.bucket "${TF_ACCOUNT_ID}/${TF_R2_BUCKET_NAME}/${TF_R2_BUCKET_JURISDICTION}"

echo "[import] dns records"
echo "${TF_DNS_RECORD_IMPORTS_JSON}" | jq -r 'to_entries[] | @base64' | while read -r row; do
  kv="$(decode_base64 "${row}")"
  key="$(echo "${kv}" | jq -r '.key')"
  record_id="$(echo "${kv}" | jq -r '.value')"
  terraform -chdir="${ENV_DIR}" import "module.stack.cloudflare_dns_record.records[\"${key}\"]" "${TF_ZONE_ID}/${record_id}"
done

if [[ -n "${TF_ACCESS_APP_ID:-}" && ! "${TF_ACCESS_APP_ID}" =~ ^REPLACE_WITH_ ]]; then
  echo "[import] access app"
  terraform -chdir="${ENV_DIR}" import module.stack.cloudflare_zero_trust_access_application.app[0] "accounts/${TF_ACCOUNT_ID}/${TF_ACCESS_APP_ID}"
fi

echo "[import] access policies"
echo "${TF_ACCESS_POLICY_IMPORTS_JSON}" | jq -r 'to_entries[] | @base64' | while read -r row; do
  kv="$(decode_base64 "${row}")"
  key="$(echo "${kv}" | jq -r '.key')"
  policy_id="$(echo "${kv}" | jq -r '.value')"
  terraform -chdir="${ENV_DIR}" import "module.stack.cloudflare_zero_trust_access_policy.policy[\"${key}\"]" "${TF_ACCOUNT_ID}/${policy_id}"
done

echo "[import] complete for ${ENV_NAME}"
