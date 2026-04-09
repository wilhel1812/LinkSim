provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Pages, D1, R2, DNS, and Access scopes."
  type        = string
  sensitive   = true
}

module "stack" {
  source = "../../modules/linksim_cloudflare"

  account_id                = var.account_id
  zone_id                   = var.zone_id
  project_name              = var.project_name
  project_production_branch = var.project_production_branch
  pages_compatibility_date  = var.pages_compatibility_date
  pages_domains             = var.pages_domains
  pages_env_vars_plain      = var.pages_env_vars_plain
  pages_env_vars_secret     = var.pages_env_vars_secret
  d1_database_name          = var.d1_database_name
  d1_database_id            = var.d1_database_id
  d1_binding_name           = var.d1_binding_name
  r2_bucket_name            = var.r2_bucket_name
  r2_binding_name           = var.r2_binding_name
  r2_bucket_jurisdiction    = var.r2_bucket_jurisdiction
  dns_records               = var.dns_records
  access_application        = var.access_application
  access_policies           = var.access_policies
}
