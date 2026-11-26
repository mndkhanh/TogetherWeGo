# Production. Same modules as dev; what differs is resilience:
#   - Postgres Multi-AZ (synchronous standby, automatic failover), deletion protection,
#     14 days of backups, a final snapshot, Performance Insights
#   - Valkey with a replica in another AZ and automatic failover
#   - at least 2 EC2 instances (one per AZ), 2 API tasks and 2 workers (all jobs are safe
#     to run on several workers: SKIP LOCKED, idempotent schedulers, deterministic job ids)
#   - WAF on CloudFront, alarms always on, 90 days of logs
locals {
  name = "twg-prod"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "togetherwego", Environment = "prod", ManagedBy = "terraform" }
  }
}

# CloudFront's WAF must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "togetherwego", Environment = "prod", ManagedBy = "terraform" }
  }
}

# Shared between CloudFront (adds the header) and the ALB/app (require it).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "cluster" {
  source               = "../../modules/cluster"
  name                 = local.name
  min_instances        = 2
  max_instances        = 4
  vpc_id               = module.network.vpc_id
  public_subnet_ids    = module.network.public_subnet_ids
  origin_verify_secret = random_password.origin_verify.result
}

module "data" {
  source                    = "../../modules/data"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  private_subnet_ids        = module.network.private_subnet_ids
  client_security_group_ids = [module.cluster.instance_security_group_id]
  db_instance_class         = "db.t4g.small"
  db_multi_az               = true
  deletion_protection       = true
  db_backup_retention_days  = 14
  db_performance_insights   = true
  redis_replicas            = 1
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Named up front (account id keeps it globally unique) so the web CSP can allow it
  # without a dependency cycle: the bucket's CORS needs the CloudFront domain.
  receipts_bucket = "${local.name}-receipts-${data.aws_caller_identity.current.account_id}"
  receipts_origin = "https://${local.receipts_bucket}.s3.${data.aws_region.current.region}.amazonaws.com"
}

module "waf" {
  source    = "../../modules/waf"
  providers = { aws = aws.us_east_1 }
  name      = local.name
}

module "web" {
  source               = "../../modules/web"
  name                 = local.name
  alb_dns_name         = module.cluster.alb_dns_name
  origin_verify_secret = random_password.origin_verify.result
  upload_origins       = [local.receipts_origin]
  web_acl_arn          = module.waf.web_acl_arn
}

module "storage" {
  source      = "../../modules/storage"
  bucket_name = local.receipts_bucket
  app_origin  = "https://${module.web.domain_name}"
}

module "services" {
  source                 = "../../modules/services"
  name                   = local.name
  cluster_arn            = module.cluster.cluster_arn
  capacity_provider_name = module.cluster.capacity_provider_name
  image                  = "${module.cluster.ecr_repository_url}:${var.initial_image_tag}"
  api_target_group_arn   = module.cluster.api_target_group_arn
  app_origin             = "https://${module.web.domain_name}"
  db_host                = module.data.db_host
  db_name                = module.data.db_name
  db_master_secret_arn   = module.data.db_master_secret_arn
  redis_url              = module.data.redis_url
  origin_verify_secret   = random_password.origin_verify.result
  google_client_id       = var.google_client_id
  google_client_secret   = var.google_client_secret
  receipts_bucket_name   = module.storage.bucket_name
  receipts_bucket_arn    = module.storage.bucket_arn
  aws_region             = data.aws_region.current.region
  mail_from              = var.mail_from
  ses_identity_arn       = var.ses_identity_arn
  api_desired_count      = 2
  worker_desired_count   = 2
  log_retention_days     = 90
}

module "github_oidc" {
  source               = "../../modules/github-oidc"
  name                 = local.name
  github_repository    = var.github_repository
  create_oidc_provider = var.create_github_oidc_provider
  ecr_repository_arn   = module.cluster.ecr_repository_arn
  cluster_arn          = module.cluster.cluster_arn
  task_families        = values(module.services.task_families)
  pass_role_arns       = module.services.task_role_arns
  web_bucket_arn       = module.web.bucket_arn
  distribution_arn     = module.web.distribution_arn
}

module "monitoring" {
  source                      = "../../modules/monitoring"
  name                        = local.name
  alarm_emails                = var.alarm_emails
  alb_arn_suffix              = module.cluster.alb_arn_suffix
  api_target_group_arn_suffix = module.cluster.api_target_group_arn_suffix
  cluster_name                = module.cluster.cluster_name
  services = {
    (module.services.service_names.api)    = 2
    (module.services.service_names.worker) = 2
  }
  db_instance_identifier  = module.data.db_instance_identifier
  redis_cache_cluster_ids = module.data.redis_cache_cluster_ids
  worker_log_group_name   = module.services.log_group_names["worker"]
}
