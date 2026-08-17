account_id                = "85c57e0c4da3a747a09212dc5b090f52"
zone_id                   = "a3e8d2285955eeb31f5a0757e7bc0181"
project_name              = "linksim-staging"
project_production_branch = "main"
pages_compatibility_date  = "2026-03-12"

pages_domains = ["staging.linksim.link"]

pages_env_vars_plain = {
  ACCESS_TEAM_DOMAIN                              = "skarvassbu.cloudflareaccess.com"
  ADMIN_USER_IDS                                  = "f35e2a08-3713-5671-9725-ba82b21f25d4"
  REGISTRATION_MODE                               = "open"
  AVATAR_FALLBACK_ORIGIN                          = "https://linksim.pages.dev"
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE     = "6000"
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE = "600"
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE            = "120"
}

pages_access_audience_keys = ["authenticated_api", "pages_previews"]

# Keep secrets out of tfvars. Inject at runtime, for example:
# TF_VAR_pages_env_vars_secret='{"VITE_MAPTILER_KEY":"..."}'

d1_database_name = "linksim_staging"
d1_database_id   = "a35d016c-f2b8-40c8-ade9-b0f1b2b1bf1c"

r2_bucket_name         = "linksim-avatars-staging"
r2_bucket_jurisdiction = "default"

dns_records = {
  staging = {
    name    = "staging.linksim.link"
    type    = "CNAME"
    content = "linksim-staging.pages.dev"
    ttl     = 1
    proxied = true
  }
}

# Access app configuration; app and policy IDs stay in imports.env.
access_applications = {
  primary = {
    name   = "LinkSim Staging Public App Shell"
    domain = "staging.linksim.link"
    type   = "self_hosted"
    policy_bindings = [
      {
        id         = "32915afb-f399-4c5c-90ea-e5bf0f377b7c"
        precedence = 1
      }
    ]
  }
  authenticated_api = {
    name   = "LinkSim Staging Authenticated API"
    domain = "staging.linksim.link/api/*"
    type   = "self_hosted"
    policy_bindings = [
      {
        id         = "fd96072d-843b-4320-811a-281767b011ee"
        precedence = 1
      }
    ]
  }
  pages_root = {
    name   = "LinkSim Staging Pages Root"
    domain = "linksim-staging.pages.dev"
    type   = "self_hosted"
    policy_bindings = [
      {
        id         = "32915afb-f399-4c5c-90ea-e5bf0f377b7c"
        precedence = 1
      }
    ]
  }
  pages_previews = {
    name   = "LinkSim Staging Pages Previews"
    domain = "*.linksim-staging.pages.dev"
    type   = "self_hosted"
    policy_bindings = [
      {
        id         = "fd96072d-843b-4320-811a-281767b011ee"
        precedence = 1
      }
    ]
  }
}

# Import-first stubs. Populate with real policy keys/names/decisions before import.
access_policies = {}
