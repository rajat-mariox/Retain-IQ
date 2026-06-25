variable "environment" {
  type        = string
  description = "Environment name (staging | production)."
}

variable "region" {
  type        = string
  default     = "ap-south-1"
  description = "AWS region (tenant home region)."
}

variable "eks_node_pools" {
  type = map(object({
    instance_types = list(string)
    min_size       = number
    max_size       = number
  }))
  default = {
    general-api   = { instance_types = ["m6i.large"], min_size = 2, max_size = 10 }
    worker        = { instance_types = ["m6i.large"], min_size = 1, max_size = 20 }
    observability = { instance_types = ["m6i.large"], min_size = 1, max_size = 3 }
  }
}
