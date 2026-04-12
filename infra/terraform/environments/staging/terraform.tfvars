account_id                = "85c57e0c4da3a747a09212dc5b090f52"
zone_id                   = "a3e8d2285955eeb31f5a0757e7bc0181"
project_name              = "linksim-staging"
project_production_branch = "main"
pages_compatibility_date  = "2026-03-12"

pages_domains = ["staging.linksim.link"]

pages_env_vars_plain = {
  ACCESS_TEAM_DOMAIN                              = "skarvassbu.cloudflareaccess.com"
  ACCESS_AUD                                      = "08eb695895482e6a14ff49332f3491d0aa02c751670d37983aa7dbbe0da16a08,dcfed08418380b9ad6fa4d26cc6ba5d94274a8920764dbcb0e1917957d1825b2"
  ADMIN_USER_IDS                                  = "f35e2a08-3713-5671-9725-ba82b21f25d4"
  REGISTRATION_MODE                               = "approval_required"
  AVATAR_FALLBACK_ORIGIN                          = "https://linksim.pages.dev"
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE     = "6000"
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE = "600"
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE            = "120"
}

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
access_application = {
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

# Import-first stubs. Populate with real policy keys/names/decisions before import.
access_policies = {}
