# Terraform Runbook (Beginner Friendly)

This runbook explains how to safely adopt and operate Terraform for LinkSim Cloudflare resources.

## 1) Concepts in plain language

- Terraform code: the desired infrastructure definition in git.
- Terraform state: Terraform's memory of what resource maps to what live Cloudflare object.
- Import: adds already-existing live resources to state, without recreating them.
- Plan: preview of what Terraform would change.
- Apply: executes the plan and changes live infrastructure.

For this rollout we use a safe pattern:

1. Adoption step (import everything first).
2. Management step (allow controlled updates only after clean baseline plan).

## 2) Prerequisites

Install tools:

- Terraform CLI (`>= 1.5`)
- Node.js + npm
- `jq`
- Wrangler CLI auth (`npx wrangler whoami` should succeed)

Required credentials and env vars:

- Cloudflare API token for provider:
  - `export TF_VAR_cloudflare_api_token="..."`
- R2 credentials for Terraform backend state bucket:
  - `export AWS_ACCESS_KEY_ID="..."`
  - `export AWS_SECRET_ACCESS_KEY="..."`
- Optional Pages secret vars at apply-time (never commit values):
  - `export TF_VAR_pages_env_vars_secret='{"VITE_MAPTILER_KEY":"..."}'`

## 3) Backend bootstrap (one-time)

1. Create the state bucket (or verify it exists):
   - `npm run tf:bootstrap:state`
2. Create backend config files from examples:
   - `cp infra/terraform/environments/staging/backend.hcl.example infra/terraform/environments/staging/backend.hcl`
   - `cp infra/terraform/environments/prod/backend.hcl.example infra/terraform/environments/prod/backend.hcl`
3. Run init for desired environment:
   - `npm run tf:init:staging`
   - or `npm run tf:init:prod`

State keys used:

- `state/staging/terraform.tfstate`
- `state/prod/terraform.tfstate`

## 4) Discovery before import

Use discovery script to collect current IDs and verify what exists:

- `npm run tf:discover:staging`
- `npm run tf:discover:prod`

Fill import input files from examples:

- `infra/terraform/environments/staging/imports.env`
- `infra/terraform/environments/prod/imports.env`

Populate IDs for:

- Pages project/domain
- D1 database
- R2 bucket
- DNS record IDs in `linksim.link`
- Access app/policy IDs

## 5) Step A: Adoption (safe import)

### Important Pages caveat

Cloudflare provider docs state that Pages projects with secret environment variables cannot be imported directly.

If import fails because of this:

1. Temporarily remove the secret env var from Pages dashboard.
2. Run import.
3. Restore the secret value via Terraform-managed input (`TF_VAR_pages_env_vars_secret`) in management step.

### Import flow

For staging:

1. `npm run tf:init:staging`
2. `npm run tf:import:staging`
3. `terraform -chdir=infra/terraform/environments/staging state list`
4. `npm run tf:plan:staging`

For production:

1. `npm run tf:init:prod`
2. `npm run tf:import:prod`
3. `terraform -chdir=infra/terraform/environments/prod state list`
4. `npm run tf:plan:prod`

Adoption is complete when plan is zero-diff or only expected/documented drift.

## 6) Step B: Management (controlled updates)

After import baseline is trusted:

1. Review temporary lifecycle guards (`ignore_changes`) in module code.
2. Remove/relax one guard at a time in a dedicated PR.
3. Run validate + plan again.
4. Apply only after plan review.

Keep `prevent_destroy` on critical resources unless a deliberate, reviewed change requires otherwise.

## 7) Validation commands (local + CI alignment)

- `npm run tf:fmt`
- `npm run tf:validate`

CI workflow (`.github/workflows/terraform-validate.yml`) runs only:

- `terraform fmt -check -recursive`
- `terraform init -backend=false`
- `terraform validate`

No CI plan/apply automation is included in this issue.

## 8) Rollback and emergency manual override

If a Terraform-driven change causes an incident:

1. Stop further applies immediately.
2. Revert via Cloudflare dashboard/CLI to known-good configuration.
3. Capture what was changed and why.
4. Update Terraform code/state so the next plan reflects reality again.
5. Re-run `npm run tf:validate` and environment `tf:plan` before any new apply.

Use emergency manual edits only for incident recovery; reconcile Terraform right after.

## 9) Safety rules

- Single-writer applies only (one operator at a time).
- Never commit secrets to git.
- Never apply unreviewed non-zero plans.
- Keep `linksim.wilhelmfrancke.com` domains out of Terraform scope for this pass.
