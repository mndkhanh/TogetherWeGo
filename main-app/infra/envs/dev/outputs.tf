output "app_url" {
  value = "https://${module.web.domain_name}"
}

# Values to set as GitHub Actions repository variables (Settings > Secrets and variables > Actions > Variables).
output "github_actions_variables" {
  value = {
    APP_URL                    = "https://${module.web.domain_name}"
    AWS_REGION                 = var.region
    AWS_DEPLOY_ROLE_ARN        = module.github_oidc.deploy_role_arn
    ECR_REPOSITORY_URL         = module.cluster.ecr_repository_url
    ECS_CLUSTER                = module.cluster.cluster_name
    ECS_CAPACITY_PROVIDER      = module.cluster.capacity_provider_name
    ECS_API_FAMILY             = module.services.task_families["api"]
    ECS_WORKER_FAMILY          = module.services.task_families["worker"]
    ECS_MIGRATE_FAMILY         = module.services.task_families["migrate"]
    WEB_BUCKET                 = module.web.bucket_name
    CLOUDFRONT_DISTRIBUTION_ID = module.web.distribution_id
  }
}

output "log_groups" {
  value = module.services.log_group_names
}
