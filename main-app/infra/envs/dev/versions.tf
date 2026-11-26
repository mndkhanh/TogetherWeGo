terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Fill in the bucket from `terraform output state_bucket` in infra/bootstrap.
  # S3-native locking (use_lockfile) replaces the old DynamoDB lock table.
  backend "s3" {
    key          = "togetherwego/dev/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
