#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -eq 0 ]]; then
  TARGETS=(staging prod)
else
  TARGETS=("$@")
fi

for env in "${TARGETS[@]}"; do
  ENV_DIR="${ROOT_DIR}/environments/${env}"
  if [[ ! -d "${ENV_DIR}" ]]; then
    echo "Unknown environment: ${env}"
    exit 1
  fi
  terraform -chdir="${ENV_DIR}" init -backend=false
  terraform -chdir="${ENV_DIR}" validate
  echo "[validate] ${env} ok"
done
