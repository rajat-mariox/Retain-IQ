resource "aws_db_subnet_group" "this" {
  name       = "${var.environment}-retainiq"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.environment}-retainiq-postgres"
  allocated_storage      = var.allocated_storage
  storage_type           = "gp3"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.instance_class
  db_name                = var.database_name
  username               = var.username
  password               = var.password
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.security_group_ids
  publicly_accessible    = false
  skip_final_snapshot    = var.environment != "production"
  backup_retention_period = var.backup_retention
  storage_encrypted      = true
  apply_immediately      = true

  tags = {
    Name        = "${var.environment}-retainiq-postgres"
    ManagedBy   = "terraform"
    Environment = var.environment
  }
}
