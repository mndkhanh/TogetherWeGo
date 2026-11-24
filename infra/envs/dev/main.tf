locals {
  name = "twg-dev"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "togetherwego", Environment = "dev", ManagedBy = "terraform" }
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
  # Dev: allow `terraform destroy`. Set true (and Multi-AZ) for prod.
  deletion_protection = false
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Named up front (account id keeps it globally unique) so the web CSP can allow it
  # without a dependency cycle: the bucket's CORS needs the CloudFront domain.
  receipts_bucket = "${local.name}-receipts-${data.aws_caller_identity.current.account_id}"
  receipts_origin = "https://${local.receipts_bucket}.s3.${data.aws_region.current.region}.amazonaws.com"
}

module "web" {
  source               = "../../modules/web"
  name                 = local.name
  alb_dns_name         = module.cluster.alb_dns_name
  origin_verify_secret = random_password.origin_verify.result
  upload_origins       = [local.receipts_origin]
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
