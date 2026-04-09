# Terraform IaC for LinkSim Cloudflare

This document defines the Cloudflare infrastructure that LinkSim manages with Terraform.

## Why this exists

Before this rollout, several Cloudflare resources were changed manually in dashboards and CLI commands. Terraform gives one auditable source of truth and a safer change process.

## In-scope resources (Issue #188)

Terraform manages these resources for both `staging` and `prod` environments:

- Pages projects (`cloudflare_pages_project`)
  - `linksim-staging`
  - `linksim`
- Pages custom domains (`cloudflare_pages_domain`)
  - `staging.linksim.link`
  - `linksim.link`
- D1 databases (`cloudflare_d1_database`)
  - `linksim_staging`
  - `linksim`
- R2 buckets (`cloudflare_r2_bucket`)
  - `linksim-avatars-staging`
  - `linksim-avatars`
- DNS records in zone `linksim.link` (`cloudflare_dns_record`)
- Access applications and Access policies for LinkSim hostnames
  - `cloudflare_zero_trust_access_application`
  - `cloudflare_zero_trust_access_policy`

## Explicitly out of scope

The `linksim.wilhelmfrancke.com` domains are intentionally **not** managed by Terraform in this pass.

## Repository layout

- `infra/terraform/modules/linksim_cloudflare`: shared module for Cloudflare resources.
- `infra/terraform/environments/staging`: staging root module + backend config templates.
- `infra/terraform/environments/prod`: production root module + backend config templates.
- `infra/terraform/scripts`: helper scripts for init/fmt/validate/import/plan/backend bootstrap/discovery.

## Remote state backend

Terraform state is stored in a dedicated Cloudflare R2 bucket through Terraform's S3 backend.

- Staging key: `state/staging/terraform.tfstate`
- Production key: `state/prod/terraform.tfstate`

Backend config templates:

- `infra/terraform/environments/staging/backend.hcl.example`
- `infra/terraform/environments/prod/backend.hcl.example`

Important: this setup currently uses **single-writer discipline**. Do not run two `terraform apply` operations in parallel.

## Secret strategy

Secrets must not be committed to git and must not be stored in `terraform.tfvars`.

- Cloudflare provider token: `TF_VAR_cloudflare_api_token`
- Backend credentials: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
- Pages secrets (example): `TF_VAR_pages_env_vars_secret='{"VITE_MAPTILER_KEY":"..."}'`

## Two-step safe rollout model

### Step A: Adoption (import-first)

Goal: attach existing live resources to Terraform state without changing behavior.

- Keep safety lifecycle guards in place:
  - `prevent_destroy = true` on critical resources
  - import-first `ignore_changes` guards for risky attributes
- Import all in-scope resources into state.
- Verify with `terraform plan` until diff is zero or only expected/documented drift.

### Step B: Management (controlled updates)

Goal: enable routine Terraform-driven updates after baseline is proven.

- Review post-import plan baseline.
- Remove/relax selected temporary `ignore_changes` guards in a dedicated PR.
- Keep `prevent_destroy` on critical resources until team explicitly decides otherwise.
- Continue requiring plan review before apply.

## CI policy in this issue

CI intentionally runs validation only (no plan/apply automation):

- `terraform fmt -check -recursive`
- `terraform init -backend=false`
- `terraform validate`

Workflow file: `.github/workflows/terraform-validate.yml`

## Operator commands

Package.json includes helper commands:

- `npm run tf:fmt`
- `npm run tf:validate`
- `npm run tf:init:staging`
- `npm run tf:init:prod`
- `npm run tf:import:staging`
- `npm run tf:import:prod`
- `npm run tf:plan:staging`
- `npm run tf:plan:prod`

See [docs/terraform-runbook.md](./terraform-runbook.md) for full end-to-end procedure.
