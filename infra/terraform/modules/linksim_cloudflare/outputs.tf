output "pages_project_name" {
  value       = cloudflare_pages_project.project.name
  description = "Managed Pages project name."
}

output "d1_database_name" {
  value       = cloudflare_d1_database.database.name
  description = "Managed D1 database name."
}

output "r2_bucket_name" {
  value       = cloudflare_r2_bucket.bucket.name
  description = "Managed R2 bucket name."
}

output "managed_dns_record_ids" {
  value       = { for key, rec in cloudflare_dns_record.records : key => rec.id }
  description = "Managed DNS record IDs keyed by dns_records map key."
}

output "access_application_ids" {
  value       = { for key, app in cloudflare_zero_trust_access_application.app : key => app.id }
  description = "Managed Access application IDs keyed by access_applications map key."
}

output "access_policy_ids" {
  value       = { for key, pol in cloudflare_zero_trust_access_policy.policy : key => pol.id }
  description = "Managed Access policy IDs keyed by access_policies map key."
}
