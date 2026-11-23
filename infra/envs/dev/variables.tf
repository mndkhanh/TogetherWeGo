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

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}
