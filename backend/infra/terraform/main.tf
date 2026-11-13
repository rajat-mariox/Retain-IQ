module "rds" {
  source              = "./modules/rds"
  environment         = var.environment
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = var.database_security_group_ids
  password            = var.database_password
  backup_retention    = var.environment == "production" ? 7 : 1
}

module "elasticache" {
  source             = "./modules/elasticache"
  environment        = var.environment
  subnet_ids         = var.private_subnet_ids
  security_group_ids = var.database_security_group_ids
}
