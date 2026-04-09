variable "account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "project_name" {
  type = string
}

variable "project_production_branch" {
  type    = string
  default = "main"
}

variable "pages_compatibility_date" {
  type = string
}

variable "pages_domains" {
  type = set(string)
}

variable "pages_env_vars_plain" {
  type    = map(string)
  default = {}
}

variable "pages_env_vars_secret" {
  type      = map(string)
  default   = {}
  sensitive = true
}

variable "d1_database_name" {
  type = string
}

variable "d1_database_id" {
  type = string
}

variable "d1_binding_name" {
  type    = string
  default = "DB"
}

variable "r2_bucket_name" {
  type = string
}

variable "r2_binding_name" {
  type    = string
  default = "AVATAR_BUCKET"
}

variable "r2_bucket_jurisdiction" {
  type    = string
  default = "default"
}

variable "dns_records" {
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
  type = map(object({
    name     = string
    decision = string
  }))
  default = {}
}
