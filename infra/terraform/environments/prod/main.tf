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

  account_id                                 = var.account_id
  zone_id                                    = var.zone_id
  project_name                               = var.project_name
  project_production_branch                  = var.project_production_branch
  pages_compatibility_date                   = var.pages_compatibility_date
  pages_domains                              = var.pages_domains
  pages_env_vars_plain                       = var.pages_env_vars_plain
  pages_env_vars_secret                      = var.pages_env_vars_secret
  pages_production_env_vars_plain            = var.pages_production_env_vars_plain
  pages_production_durable_object_namespaces = var.pages_production_durable_object_namespaces
  pages_access_audience_keys                 = var.pages_access_audience_keys
  d1_database_name                           = var.d1_database_name
  d1_database_id                             = var.d1_database_id
  d1_binding_name                            = var.d1_binding_name
  r2_bucket_name                             = var.r2_bucket_name
  r2_binding_name                            = var.r2_binding_name
  r2_bucket_jurisdiction                     = var.r2_bucket_jurisdiction
  dns_records                                = var.dns_records
  access_applications                        = var.access_applications
  access_policies                            = var.access_policies
}

# This resource is intentionally independent of the Pages module. Declaring or
# creating the bucket must not bind it to production or enable archive writes.
resource "cloudflare_r2_bucket" "history" {
  account_id   = var.account_id
  name         = "linksim-history"
  jurisdiction = "default"

  lifecycle {
    prevent_destroy = true
  }
}
