resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.environment}-retainiq"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.environment}-retainiq-redis"
  engine               = "redis"
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = var.security_group_ids
  apply_immediately    = true

  tags = {
    Name        = "${var.environment}-retainiq-redis"
    ManagedBy   = "terraform"
    Environment = var.environment
  }
}
