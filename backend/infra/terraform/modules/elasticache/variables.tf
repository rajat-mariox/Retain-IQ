variable "environment" {
  type        = string
  description = "Environment name"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the Redis subnet group"
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs for the Redis cluster"
}

variable "node_type" {
  type        = string
  default     = "cache.t4g.micro"
}
