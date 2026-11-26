# Private bucket for receipt photos.
#   - The browser uploads straight to S3 with a presigned POST from the API (key, type and
#     size are pinned by the signature), and views photos through 5-minute presigned GETs.
#   - No public access, no ACLs, TLS only, encrypted at rest.

variable "bucket_name" {
  description = "Globally unique; decided by the caller so the web CSP can name it up front"
  type        = string
}

variable "app_origin" {
  description = "The only origin allowed to upload from a browser (CORS)"
  type        = string
}

resource "aws_s3_bucket" "receipts" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket                  = aws_s3_bucket.receipts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = [var.app_origin]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "receipts" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.receipts.arn, "${aws_s3_bucket.receipts.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "receipts" {
  bucket     = aws_s3_bucket.receipts.id
  policy     = data.aws_iam_policy_document.receipts.json
  depends_on = [aws_s3_bucket_public_access_block.receipts]
}

output "bucket_name" {
  value = aws_s3_bucket.receipts.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.receipts.arn
}
