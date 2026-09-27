#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${ROOT_DIR}/environments/prod"
PLAN_PATH="${ENV_DIR}/prod-history.tfplan"
TEMP_PLAN_PATH="${ENV_DIR}/prod-history.tmp.tfplan"

cleanup_plan() {
  local status=$?
  rm -f "${TEMP_PLAN_PATH}"
  if [[ ${status} -ne 0 ]]; then
    rm -f "${PLAN_PATH}"
  fi
  return "${status}"
}

trap cleanup_plan EXIT
rm -f "${PLAN_PATH}" "${TEMP_PLAN_PATH}"

if [[ ! -f "${ENV_DIR}/backend.hcl" ]]; then
  echo "Missing ${ENV_DIR}/backend.hcl"
  exit 1
fi

if [[ -z "${TF_VAR_cloudflare_api_token:-}" ]]; then
  echo "Set TF_VAR_cloudflare_api_token in your environment before planning."
  exit 1
fi

"${ROOT_DIR}/scripts/init.sh" prod

# This exceptional target is narrower than the ordinary production plan. It
# refreshes the history resource normally while excluding unrelated resources
# from the saved apply artifact. The fail-closed validator remains authoritative
# and the ordinary plan remains the separate drift audit.
terraform -chdir="${ENV_DIR}" plan \
  -target=cloudflare_r2_bucket.history \
  -out="${TEMP_PLAN_PATH}"
mv "${TEMP_PLAN_PATH}" "${PLAN_PATH}"
