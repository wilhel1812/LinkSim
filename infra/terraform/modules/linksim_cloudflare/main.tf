terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

locals {
  managed_access_audiences = [
    for key in var.pages_access_audience_keys : cloudflare_zero_trust_access_application.app[key].aud
  ]

  effective_pages_env_vars_plain = merge(
    var.pages_env_vars_plain,
    length(local.managed_access_audiences) == 0 ? {} : {
      ACCESS_AUD = join(",", local.managed_access_audiences)
    },
  )

  pages_env_vars_plain = {
    for name, value in local.effective_pages_env_vars_plain :
    name => {
      type  = "plain_text"
      value = value
    }
  }

  pages_env_vars_secret = {
    for name, value in var.pages_env_vars_secret :
    name => {
      type  = "secret_text"
      value = value
    }
  }

  pages_env_vars = merge(local.pages_env_vars_plain, local.pages_env_vars_secret)
}

resource "cloudflare_pages_project" "project" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = var.project_production_branch

  deployment_configs = {
    preview = {
      compatibility_date = var.pages_compatibility_date
      d1_databases = {
        (var.d1_binding_name) = {
          id = var.d1_database_id
        }
      }
      r2_buckets = {
        (var.r2_binding_name) = {
          name = var.r2_bucket_name
        }
      }
      env_vars = local.pages_env_vars
    }
    production = {
      compatibility_date = var.pages_compatibility_date
      d1_databases = {
        (var.d1_binding_name) = {
          id = var.d1_database_id
        }
      }
      r2_buckets = {
        (var.r2_binding_name) = {
          name = var.r2_bucket_name
        }
      }
      env_vars = local.pages_env_vars
    }
  }

  lifecycle {
    # Adoption step safety: prevents accidental broad config rewrites until
    # all live values are imported and reviewed.
    ignore_changes  = [deployment_configs]
    prevent_destroy = true
  }
}

resource "cloudflare_pages_domain" "custom_domains" {
  for_each = var.pages_domains

  account_id   = var.account_id
  project_name = var.project_name
  name         = each.value

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "database" {
  account_id = var.account_id
  name       = var.d1_database_name
  read_replication = {
    mode = var.d1_read_replication_mode
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "bucket" {
  account_id   = var.account_id
  name         = var.r2_bucket_name
  jurisdiction = var.r2_bucket_jurisdiction

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "records" {
  for_each = var.dns_records

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  ttl     = each.value.ttl
  proxied = try(each.value.proxied, null)
  comment = try(each.value.comment, null)

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "app" {
  for_each = var.access_applications

  account_id = var.account_id
  name       = each.value.name
  domain     = each.value.domain
  type       = each.value.type

  policies = [
    for binding in each.value.policy_bindings : {
      id         = binding.id
      precedence = binding.precedence
    }
  ]

  lifecycle {
    # Adoption step safety: avoid mutating live Access app defaults/policy wiring
    # until all intended app/policy resources are modeled in Terraform.
    ignore_changes  = all
    prevent_destroy = true
  }
}

moved {
  from = cloudflare_zero_trust_access_application.app[0]
  to   = cloudflare_zero_trust_access_application.app["primary"]
}

resource "cloudflare_zero_trust_access_policy" "policy" {
  for_each = var.access_policies

  account_id = var.account_id
  name       = each.value.name
  decision   = each.value.decision

  lifecycle {
    # Adoption step safety: these policy resources are imported first.
    ignore_changes  = all
    prevent_destroy = true
  }
}
