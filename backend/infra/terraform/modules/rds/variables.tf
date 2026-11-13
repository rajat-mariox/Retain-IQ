variable "environment" {
  type        = string
  description = "Environment name"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the DB subnet group"
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs for the DB instance"
}

variable "allocated_storage" {
  type        = number
  default     = 20
}

variable "instance_class" {
  type        = string
  default     = "db.t4g.micro"
}

variable "database_name" {
  type        = string
  default     = "retainiq"
}

variable "username" {
  type        = string
  default     = "retainiq"
}

variable "password" {
  type        = string
  sensitive   = true
}

variable "backup_retention" {
  type        = number
  default     = 7
}
