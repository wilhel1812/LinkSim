variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID for linksim.link (used for DNS records)."
  type        = string
}

variable "project_name" {
  description = "Cloudflare Pages project name."
  type        = string
}

variable "project_production_branch" {
  description = "Pages production branch."
  type        = string
  default     = "main"
}

variable "pages_compatibility_date" {
  description = "Pages Functions compatibility date."
  type        = string
}

variable "pages_domains" {
  description = "Custom domains attached to this Pages project."
  type        = set(string)
}

variable "pages_env_vars_plain" {
  description = "Non-secret Pages env vars to manage."
  type        = map(string)
  default     = {}
}

variable "pages_env_vars_secret" {
  description = "Secret Pages env vars. Provide via secure TF input in CI/local shell."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "d1_database_name" {
  description = "D1 database name."
  type        = string
}

variable "d1_database_id" {
  description = "D1 database UUID used by Pages binding."
  type        = string
}

variable "d1_read_replication_mode" {
  description = "D1 read replication mode."
  type        = string
  default     = "disabled"
}

variable "d1_binding_name" {
  description = "Pages D1 binding name."
  type        = string
  default     = "DB"
}

variable "r2_bucket_name" {
  description = "R2 bucket name."
  type        = string
}

variable "r2_binding_name" {
  description = "Pages R2 binding name."
  type        = string
  default     = "AVATAR_BUCKET"
}

variable "r2_bucket_jurisdiction" {
  description = "R2 jurisdiction segment used by import ID."
  type        = string
  default     = "default"
}

variable "dns_records" {
  description = "DNS records managed in linksim.link zone (keyed map for stable imports)."
  type = map(object({
    name    = string
    type    = string
    content = string
    ttl     = number
    proxied = optional(bool)
    comment = optional(string)
  }))
  default = {}
}

variable "access_application" {
  description = "Account-level Access app for this environment. Set null to skip Access app management."
  type = object({
    name   = string
    domain = string
    type   = optional(string, "self_hosted")
    policy_bindings = optional(list(object({
      id         = string
      precedence = number
    })), [])
  })
  default = null
}

variable "access_policies" {
  description = "Access policy resources (import-first stubs). In adoption step these stay ignore_changes=all."
  type = map(object({
    name     = string
    decision = string
  }))
  default = {}
}
