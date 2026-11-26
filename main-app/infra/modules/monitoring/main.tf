# CloudWatch alarms, emailed through SNS when they fire and when they clear.
#
# What each alarm means for the app:
#   api-5xx, alb-5xx         the API (or the load balancer in front of it) is failing requests
#   api-unhealthy            an API task fails its health check
#   api-slow                 p95 response time is high
#   <service>-tasks-low      ECS is running fewer api/worker tasks than it should
#   db-cpu/storage/memory    Postgres is overloaded or running out of room
#   redis-cpu/memory-<node>  Valkey (queues, realtime) is overloaded or nearly full
#   worker-silent            no worker heartbeat: nothing sends notifications, emails or reminders
#   outbox-backlog           notifications are waiting longer than 5 minutes
#   outbox-failed            a notification was given up on after 10 attempts (needs a human)
#   email-failed             an email was given up on (check SES, bounces, the address)
#   reminder-backlog         event reminders are more than 5 minutes late
#
# The last four come from the worker's "Worker heartbeat" log line (see
# apps/server/src/jobs/system.processor.ts) through log metric filters.
#
# The SNS topic isn't KMS-encrypted: CloudWatch can't publish to a topic using the AWS-managed
# SNS key, and alarm messages carry no user data.

variable "name" {
  type = string
}

variable "alarm_emails" {
  description = "Who gets the alarms. Each address must confirm the SNS subscription email."
  type        = list(string)
  default     = []
}

variable "alb_arn_suffix" {
  type = string
}

variable "api_target_group_arn_suffix" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "services" {
  description = "ECS service name => desired task count"
  type        = map(number)
}

variable "db_instance_identifier" {
  type = string
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "redis_cache_cluster_ids" {
  type = list(string)
}

variable "worker_log_group_name" {
  type = string
}

variable "api_p95_seconds" {
  type    = number
  default = 2
}

locals {
  namespace = "TogetherWeGo/${var.name}"
  actions   = [aws_sns_topic.alarms.arn]

  # Numbers the worker logs with every heartbeat => metric names.
  backlog_metrics = {
    outboxBacklog   = "OutboxBacklog"
    outboxFailed    = "OutboxFailed"
    emailFailed     = "EmailFailed"
    reminderBacklog = "ReminderBacklog"
  }
}

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------- Load balancer and API ----------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "The API returned 10+ server errors in 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name}-alb-5xx"
  alarm_description   = "The load balancer itself returned 10+ errors in 5 minutes (no healthy targets?)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name          = "${var.name}-api-unhealthy"
  alarm_description   = "An API task has failed its health check for 3 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "api_slow" {
  alarm_name          = "${var.name}-api-slow"
  alarm_description   = "API p95 response time above ${var.api_p95_seconds}s in 3 of the last 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = var.api_p95_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---------- ECS ----------

resource "aws_cloudwatch_metric_alarm" "tasks_low" {
  for_each            = var.services
  alarm_name          = "${var.name}-${each.key}-tasks-low"
  alarm_description   = "Fewer than ${each.value} ${each.key} task(s) running for 5 minutes"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = each.key }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = each.value
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---------- Postgres ----------

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.name}-db-cpu"
  alarm_description   = "Postgres CPU above 80% for 15 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${var.name}-db-storage"
  alarm_description   = "Postgres has under 10% of its starting storage free (autoscaling may have hit its cap)"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.db_allocated_storage_gb * 1024 * 1024 * 1024 * 0.1
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "db_memory" {
  alarm_name          = "${var.name}-db-memory"
  alarm_description   = "Postgres has under 64 MB of freeable memory"
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = var.db_instance_identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 64 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---------- Valkey ----------

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  for_each          = toset(var.redis_cache_cluster_ids)
  alarm_name        = "${var.name}-redis-cpu-${each.key}"
  alarm_description = "Valkey node CPU above 80% for 15 minutes"
  namespace         = "AWS/ElastiCache"
  # Host CPU, not EngineCPUUtilization: AWS's advice for nodes with 2 vCPUs or fewer (t4g.micro),
  # where background work outside the engine thread can saturate the node.
  metric_name         = "CPUUtilization"
  dimensions          = { CacheClusterId = each.key }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  for_each            = toset(var.redis_cache_cluster_ids)
  alarm_name          = "${var.name}-redis-memory-${each.key}"
  alarm_description   = "Valkey memory above 80%: queues would start failing when full"
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  dimensions          = { CacheClusterId = each.key }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---------- Worker (from its heartbeat log line) ----------

resource "aws_cloudwatch_log_metric_filter" "heartbeat" {
  name           = "${var.name}-worker-heartbeat"
  log_group_name = var.worker_log_group_name
  pattern        = "{ $.msg = \"Worker heartbeat\" }"
  metric_transformation {
    namespace = local.namespace
    name      = "WorkerHeartbeat"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "backlog" {
  for_each       = local.backlog_metrics
  name           = "${var.name}-${each.value}"
  log_group_name = var.worker_log_group_name
  pattern        = "{ $.msg = \"Worker heartbeat\" }"
  metric_transformation {
    namespace = local.namespace
    name      = each.value
    value     = "$.${each.key}"
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_silent" {
  alarm_name          = "${var.name}-worker-silent"
  alarm_description   = "No worker heartbeat for 5 minutes: notifications, emails and reminders have stopped"
  namespace           = local.namespace
  metric_name         = "WorkerHeartbeat"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "backlog" {
  for_each = {
    OutboxBacklog   = { description = "Notifications waiting more than 5 minutes, for 10 minutes", periods = 2 }
    OutboxFailed    = { description = "A notification was given up on after 10 attempts: see outbox.last_error", periods = 1 }
    EmailFailed     = { description = "An email was given up on: see email_deliveries.last_error", periods = 1 }
    ReminderBacklog = { description = "Event reminders more than 5 minutes late, for 10 minutes", periods = 2 }
  }
  alarm_name          = "${var.name}-${lower(each.key)}"
  alarm_description   = each.value.description
  namespace           = local.namespace
  metric_name         = each.key
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = each.value.periods
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  # No data means no heartbeat, which worker-silent already reports.
  treat_missing_data = "notBreaching"
  alarm_actions      = local.actions
  ok_actions         = local.actions
  depends_on         = [aws_cloudwatch_log_metric_filter.backlog]
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}
