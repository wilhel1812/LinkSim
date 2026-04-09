#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <staging|prod> [--backend=false]"
  exit 1
fi

ENV_NAME="$1"
BACKEND_MODE="enabled"
if [[ "${2:-}" == "--backend=false" ]]; then
  BACKEND_MODE="disabled"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${ROOT_DIR}/environments/${ENV_NAME}"
BACKEND_FILE="${ENV_DIR}/backend.hcl"

if [[ ! -d "${ENV_DIR}" ]]; then
  echo "Unknown environment: ${ENV_NAME}"
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "Terraform CLI is required but not installed."
  exit 1
fi

if [[ "${BACKEND_MODE}" == "disabled" ]]; then
  TMP_TF_DATA_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_TF_DATA_DIR}"' EXIT
  TF_DATA_DIR="${TMP_TF_DATA_DIR}" terraform -chdir="${ENV_DIR}" init -backend=false
  exit 0
fi

if [[ ! -f "${BACKEND_FILE}" ]]; then
  echo "Missing ${BACKEND_FILE}. Copy backend.hcl.example -> backend.hcl and adjust values first."
  exit 1
fi

terraform -chdir="${ENV_DIR}" init -reconfigure -backend-config="${BACKEND_FILE}"
