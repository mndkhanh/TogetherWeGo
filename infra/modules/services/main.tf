# ECS task definitions and services for the API, the worker, and the one-off migration task.
#
# Terraform owns the task definitions (env vars, secrets, sizes). CI deploys new images by
# registering a copy of the latest revision with a new image tag (scripts/deploy-ecs.sh),
# so services ignore task_definition drift here.

variable "name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "capacity_provider_name" {
  type = string
}

variable "image" {
  description = "Initial image (repository_url:tag). CI replaces it on every deploy."
  type        = string
}

variable "api_target_group_arn" {
  type = string
}

variable "app_origin" {
  description = "Public origin of the web app, e.g. https://d123.cloudfront.net"
  type        = string
}

variable "db_host" {
  type = string
}

variable "db_name" {
  type = string
}

variable "db_master_secret_arn" {
  type = string
}

variable "redis_url" {
  type      = string
  sensitive = true
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
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

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 30
}

data "aws_region" "current" {}

locals {
  google_enabled = var.google_client_id != "" && var.google_client_secret != ""
}

# ---------- Secrets ----------

resource "random_password" "jwt" {
  length  = 64
  special = false
}

# App secrets in one Secrets Manager secret; ECS injects individual JSON keys as env vars.
resource "aws_secretsmanager_secret" "app" {
  name_prefix             = "${var.name}/app-"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(merge(
    {
      JWT_ACCESS_SECRET    = random_password.jwt.result
      ORIGIN_VERIFY_SECRET = var.origin_verify_secret
      REDIS_URL            = var.redis_url
    },
    local.google_enabled ? { GOOGLE_CLIENT_SECRET = var.google_client_secret } : {},
  ))
}

# ---------- IAM ----------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: used by the ECS agent to pull the image, write logs and read secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn, var.db_master_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Task role: what the application code itself may call. Empty for now (S3/SES come later).
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ---------- Logs ----------

resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(["api", "worker", "migrate"])
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# ---------- Task definitions ----------

locals {
  environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "LOG_LEVEL", value = "info" },
      { name = "APP_ORIGIN", value = var.app_origin },
      { name = "DB_HOST", value = var.db_host },
      { name = "DB_NAME", value = var.db_name },
      { name = "DB_SSL", value = "true" },
      { name = "COOKIE_SECURE", value = "true" },
      # viewer -> CloudFront -> ALB -> app
      { name = "TRUST_PROXY_HOPS", value = "2" },
    ],
    local.google_enabled ? [{ name = "GOOGLE_CLIENT_ID", value = var.google_client_id }] : [],
  )

  secrets = concat(
    [
      { name = "DB_USER", valueFrom = "${var.db_master_secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${var.db_master_secret_arn}:password::" },
      { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:REDIS_URL::" },
      { name = "JWT_ACCESS_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_ACCESS_SECRET::" },
      { name = "ORIGIN_VERIFY_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:ORIGIN_VERIFY_SECRET::" },
    ],
    local.google_enabled ? [
      { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:GOOGLE_CLIENT_SECRET::" },
    ] : [],
  )

  # Shared hardening for every container.
  base_container = {
    image                  = var.image
    essential              = true
    environment            = local.environment
    secrets                = local.secrets
    user                   = "1000:1000"
    readonlyRootFilesystem = true
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { drop = ["ALL"] }
      tmpfs              = [{ containerPath = "/tmp", size = 64 }]
    }
    stopTimeout = 30
  }

  containers = {
    api = merge(local.base_container, {
      name              = "api"
      command           = ["node", "dist/main.api.js"]
      memory            = 512
      memoryReservation = 256
      portMappings      = [{ containerPort = 3000, hostPort = 0, protocol = "tcp" }]
    })
    worker = merge(local.base_container, {
      name              = "worker"
      command           = ["node", "dist/main.worker.js"]
      memory            = 512
      memoryReservation = 256
    })
    migrate = merge(local.base_container, {
      name              = "migrate"
      command           = ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]
      memory            = 512
      memoryReservation = 256
      stopTimeout       = 120
    })
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each = local.containers

  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["EC2"]
  network_mode             = "bridge"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([merge(each.value, {
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this[each.key].name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = each.key
      }
    }
  })])
}

# ---------- Services ----------

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this["api"].arn
  desired_count   = var.api_desired_count

  capacity_provider_strategy {
    capacity_provider = var.capacity_provider_name
    weight            = 1
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 30

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this["worker"].arn
  desired_count   = var.worker_desired_count

  capacity_provider_strategy {
    capacity_provider = var.capacity_provider_name
    weight            = 1
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

output "task_families" {
  value = { for k, v in aws_ecs_task_definition.this : k => v.family }
}

output "service_names" {
  value = { api = aws_ecs_service.api.name, worker = aws_ecs_service.worker.name }
}

output "task_role_arns" {
  description = "Roles the deploy pipeline must be allowed to pass to ECS"
  value       = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
}

output "log_group_names" {
  value = { for k, v in aws_cloudwatch_log_group.this : k => v.name }
}
