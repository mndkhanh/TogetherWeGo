# WAF in front of CloudFront: AWS managed rules plus per-IP rate limits.
#
# A CloudFront web ACL must live in us-east-1, so pass this module an aws provider for that
# region (providers = { aws = aws.us_east_1 }).
#
# Rules, in order (first match wins):
#   1. Rate limit on sign-in and registration (password guessing, sign-up spam)
#   2. Rate limit on the whole API per IP (scraping, floods). The app's own throttler still
#      runs behind it; this stops a flood before it costs ALB and ECS capacity.
#   3. AWS IP reputation list (known botnets, scanners)
#   4. AWS common rule set (OWASP-style: XSS, path traversal, bad bots, oversized bodies)
#   5. AWS known bad inputs (Log4Shell, Java deserialization, host header tricks)
# Managed rules can be switched to count-only while tuning (managed_rules_count_only).

variable "name" {
  type = string
}

variable "api_rate_limit" {
  description = "Requests to /v1/ per IP per 5 minutes"
  type        = number
  default     = 2000
}

variable "auth_rate_limit" {
  description = "Requests to /v1/auth/ per IP per 5 minutes"
  type        = number
  default     = 100
}

variable "managed_rules_count_only" {
  description = "Log what the managed rules would block without blocking (for tuning)"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

locals {
  managed_rules = [
    { name = "AWSManagedRulesAmazonIpReputationList", priority = 30 },
    { name = "AWSManagedRulesCommonRuleSet", priority = 40 },
    { name = "AWSManagedRulesKnownBadInputsRuleSet", priority = 50 },
  ]
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "${var.name} CloudFront protection"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-auth"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.auth_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit-auth"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-api"
    priority = 20
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.api_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit-api"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.managed_rules
    content {
      name     = rule.value.name
      priority = rule.value.priority
      override_action {
        dynamic "none" {
          for_each = var.managed_rules_count_only ? [] : [1]
          content {}
        }
        dynamic "count" {
          for_each = var.managed_rules_count_only ? [1] : []
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-${rule.value.name}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

# ---------- Logs ----------

# WAF requires the "aws-waf-logs-" prefix.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # Never write credentials to the logs.
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
  redacted_fields {
    single_header {
      name = "x-origin-verify"
    }
  }
}

output "web_acl_arn" {
  value = aws_wafv2_web_acl.this.arn
}

output "web_acl_name" {
  value = aws_wafv2_web_acl.this.name
}
