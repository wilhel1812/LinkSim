#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <staging|prod>"
  exit 1
fi

ENV_NAME="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${ROOT_DIR}/environments/${ENV_NAME}"

if [[ ! -d "${ENV_DIR}" ]]; then
  echo "Unknown environment: ${ENV_NAME}"
  exit 1
fi

if [[ ! -f "${ENV_DIR}/backend.hcl" ]]; then
  echo "Missing ${ENV_DIR}/backend.hcl"
  exit 1
fi

if [[ -z "${TF_VAR_cloudflare_api_token:-}" ]]; then
  echo "Set TF_VAR_cloudflare_api_token in your environment before planning."
  exit 1
fi

"${ROOT_DIR}/scripts/init.sh" "${ENV_NAME}"
terraform -chdir="${ENV_DIR}" plan -out="${ENV_NAME}.tfplan"
