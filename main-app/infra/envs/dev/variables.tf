variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "github_repository" {
  description = "owner/repo allowed to deploy, e.g. mndkhanh/TogetherWeGo"
  type        = string
}

variable "create_github_oidc_provider" {
  description = "Set false if this AWS account already has the GitHub OIDC provider"
  type        = bool
  default     = true
}

variable "initial_image_tag" {
  description = "Image tag for the first apply. CI deploys real tags afterwards."
  type        = string
  default     = "bootstrap"
}

variable "mail_from" {
  description = "Sender of notification emails. Must belong to the SES identity below."
  type        = string
  default     = "TogetherWeGo <no-reply@example.com>"
}

variable "ses_identity_arn" {
  description = "ARN of a verified SES domain or address. Empty until a domain is chosen (open question 7): emails then fail and are retried, the in-app feed still works."
  type        = string
  default     = ""
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "alarm_emails" {
  description = "Who gets CloudWatch alarms. Each address must confirm the SNS subscription email."
  type        = list(string)
  default     = []
}

variable "enable_waf" {
  description = "WAF on CloudFront (about $10/month plus requests). Off in dev by default."
  type        = bool
  default     = false
}
