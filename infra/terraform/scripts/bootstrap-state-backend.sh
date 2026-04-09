#!/usr/bin/env bash
set -euo pipefail

STATE_BUCKET_NAME="${STATE_BUCKET_NAME:-linksim-terraform-state}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required."
  exit 1
fi

echo "Creating R2 bucket ${STATE_BUCKET_NAME} if it does not already exist..."
if npx wrangler r2 bucket create "${STATE_BUCKET_NAME}" >/dev/null 2>&1; then
  echo "Created bucket ${STATE_BUCKET_NAME}."
else
  echo "Bucket may already exist (continuing)."
fi

echo "Next steps:"
echo "1) Create bucket-scoped R2 API credentials with Object Read/Write"
echo "2) Export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
echo "3) Copy environments/*/backend.hcl.example -> backend.hcl"
echo "4) Run infra/terraform/scripts/init.sh <staging|prod>"
