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

For staging, `TF_ACCESS_APP_IMPORTS_JSON` must account for the stable keys
`primary`, `pages_root`, and `pages_previews`. If an application already exists,
import it; do not let a plan replace it. After import, confirm all three computed
AUD values feed the Pages `ACCESS_AUD` variable.

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

The staging history bucket is created privately through Wrangler and has an
explicit Terraform `import` block in the staging root. When backend credentials
are available, inspect the staging plan and confirm it imports only
`linksim-history-staging` and adds only the reviewed stable-staging binding and
scope. Do not apply a broader plan or attempt to recreate the bucket. Production
declares the separate `linksim-history` bucket without passing it into the Pages
module, so it has no history bucket binding in this phase.

### Production history bucket preparation

The checked-in declaration is inert until an operator runs an approved apply.
Before that separately approved production action:

1. Run `npm run tf:plan:prod` with the protected production state and provider
   credentials as the ordinary drift audit. Do not apply this plan when it
   contains any change other than the history bucket. Existing unrelated drift
   remains visible and must be reconciled separately.
2. Run `npm run tf:plan:prod-history` to produce the exceptional, refreshed
   target plan for only `cloudflare_r2_bucket.history`. Terraform will print its
   standard targeted-plan warning; this one-time isolated bucket creation is the
   reviewed exceptional use. The command does not disable refresh and does not
   change or suppress the ordinary production plan.
3. Run `npm run tf:validate:prod-history-plan`. It reads the dedicated
   `prod-history.tfplan` without writing a JSON copy and accepts only one create
   action for the fixed
   `cloudflare_r2_bucket.history` / `linksim-history` resource in the LinkSim
   account. Any Pages, D1, DNS, Access, binding, update, replacement, deletion,
   or second resource change blocks the operation.
4. Preserve the reviewed saved plan as the apply input. Do not regenerate or
   apply a broader plan. Obtain explicit production approval before applying it.
5. Apply only the validated `prod-history.tfplan`. After creation, rerun the
   normal production plan and record every remaining difference; do not apply
   unrelated drift as part of this operation. Bucket creation still does not
   authorize a Pages binding, archive writer, backfill, or authentication
   cutover.

No CI workflow plans or applies Terraform; CI only formats, initializes with
the backend disabled, and validates configuration.

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

Access policy wiring remains under the import-first lifecycle guard. The
deployment workflow therefore uses `scripts/access-boundary.mjs` as a
fail-closed observable boundary gate:

- pull-request preview: check-only `production` HTTP verification;
- shared staging after Pages deploy: check-only HTTP verification;
- production release: check-only verification before any D1 mutation.

The optional operator-only `plan staging` / `apply staging` commands never
create or delete Access applications or policies and do not support production
mutation. They require a token with Access: Apps and Policies Read for planning
and Write for the staging apply. Deployment checks use anonymous HTTP behavior
and the exact configured API audience, so the Pages deployment token does not
need broader Access permissions.

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
