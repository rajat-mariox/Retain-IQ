terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state with locking. Fill in per environment via -backend-config.
  backend "s3" {
    # bucket         = "retainiq-tfstate-<env>"
    # key            = "retainiq/<env>.tfstate"
    # region         = "ap-south-1"
    # dynamodb_table = "retainiq-tflock"
    # encrypt        = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "retainiq"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
