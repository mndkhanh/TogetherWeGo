# CloudFront in front of everything, on one origin so cookies are first-party and no CORS is needed:
#   /v1/*   -> ALB (API), never cached, with the secret x-origin-verify header
#   /*      -> private S3 bucket (SPA), via Origin Access Control
#
# Uses the default *.cloudfront.net certificate. Add a custom domain + ACM cert later.

variable "name" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
}

variable "upload_origins" {
  description = "Extra origins the app loads images from and uploads to (the receipts bucket)"
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "PriceClass_200 includes edge locations in Vietnam and Southeast Asia"
  type        = string
  default     = "PriceClass_200"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# ---------- SPA bucket ----------

resource "aws_s3_bucket" "web" {
  bucket_prefix = "${var.name}-web-"
  force_destroy = true # contents are build artifacts, re-deployable from git
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Only this CloudFront distribution may read the bucket.
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.web.arn, "${aws_s3_bucket.web.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
}

# ---------- Edge logic ----------

# Client-side routes (/login, /groups/123) are served index.html; files are served as-is.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var lastSegment = request.uri.split('/').pop();
      if (lastSegment.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.name}-security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        # qr.sepay.vn draws the VietQR code on the payment screen.
        join(" ", concat(["img-src 'self' data: blob: https://*.googleusercontent.com https://qr.sepay.vn"], var.upload_origins)),
        "font-src 'self'",
        join(" ", concat(["connect-src 'self'"], var.upload_origins)),
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ])
      override = true
    }
  }
}

# ---------- Distribution ----------

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = var.name
  default_root_object = "index.html"
  price_class         = var.price_class
  http_version        = "http2and3"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.alb_dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }

    custom_header {
      name  = "x-origin-verify"
      value = var.origin_verify_secret
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/v1/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.web.arn
}
