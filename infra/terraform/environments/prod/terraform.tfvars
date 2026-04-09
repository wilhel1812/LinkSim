account_id                = "85c57e0c4da3a747a09212dc5b090f52"
zone_id                   = "REPLACE_WITH_LINKSIM_LINK_ZONE_ID"
project_name              = "linksim"
project_production_branch = "main"
pages_compatibility_date  = "2026-03-12"

pages_domains = ["linksim.link"]

pages_env_vars_plain = {
  ACCESS_TEAM_DOMAIN                              = "skarvassbu.cloudflareaccess.com"
  ACCESS_AUD                                      = "dcfed08418380b9ad6fa4d26cc6ba5d94274a8920764dbcb0e1917957d1825b2"
  ADMIN_USER_IDS                                  = "f35e2a08-3713-5671-9725-ba82b21f25d4"
  REGISTRATION_MODE                               = "approval_required"
  AVATAR_FALLBACK_ORIGIN                          = "https://linksim.pages.dev"
  PROXY_COPERNICUS_TILE_RATE_LIMIT_PER_MINUTE     = "6000"
  PROXY_COPERNICUS_TILELIST_RATE_LIMIT_PER_MINUTE = "600"
  CALC_API_PROXY_RATE_LIMIT_PER_MINUTE            = "120"
}

# Keep secrets out of tfvars. Inject at runtime, for example:
# TF_VAR_pages_env_vars_secret='{"VITE_MAPTILER_KEY":"..."}'

d1_database_name = "linksim"
d1_database_id   = "d669aac0-37ea-4c68-9b27-ece888e1966a"

r2_bucket_name         = "linksim-avatars"
r2_bucket_jurisdiction = "default"

dns_records = {
  apex = {
    name    = "@"
    type    = "CNAME"
    content = "linksim.pages.dev"
    ttl     = 1
    proxied = true
    comment = "Terraform managed: production routing"
  }
}

# Access app configuration; app and policy IDs stay in imports.env.
access_application = {
  name            = "LinkSim Access"
  domain          = "linksim.link"
  type            = "self_hosted"
  policy_bindings = []
}

# Import-first stubs. Populate with real policy keys/names/decisions before import.
access_policies = {}
