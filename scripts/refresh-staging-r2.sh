#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "[staging-refresh:r2] aws CLI not found."
  echo "Install it, then rerun: npm run refresh:staging:r2"
  exit 1
fi

PROD_R2_BUCKET="${PROD_R2_BUCKET:-linksim-avatars}"
STAGING_R2_BUCKET="${STAGING_R2_BUCKET:-linksim-avatars-staging}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID in your shell environment}"
R2_S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Uses standard AWS env/profile credentials. For Cloudflare R2 this should be an
# R2 API token key pair with object read+write access.
echo "[staging-refresh:r2] Syncing s3://${PROD_R2_BUCKET} -> s3://${STAGING_R2_BUCKET}"
aws s3 sync "s3://${PROD_R2_BUCKET}" "s3://${STAGING_R2_BUCKET}" \
  --endpoint-url "${R2_S3_ENDPOINT}" \
  --delete

echo "[staging-refresh:r2] Complete"
