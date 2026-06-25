# Module wiring (skeleton). Uncomment and point `source` at real modules
# (registry or ./modules/*) once account/network details are decided.

# module "network" {
#   source      = "./modules/network"
#   environment = var.environment
# }

# module "eks" {
#   source      = "./modules/eks"
#   environment = var.environment
#   subnet_ids  = module.network.private_subnet_ids
#   node_pools  = var.eks_node_pools
# }

# module "rds" {
#   source              = "./modules/rds"
#   environment         = var.environment
#   subnet_ids          = module.network.private_subnet_ids
#   storage_encrypted   = true
#   backup_retention    = 7
#   deletion_protection = var.environment == "production"
# }

# module "elasticache" {
#   source      = "./modules/elasticache"
#   environment = var.environment
#   subnet_ids  = module.network.private_subnet_ids
# }

# module "s3" {
#   source                 = "./modules/s3"
#   environment            = var.environment
#   sse_kms                = true
#   screenshot_lifecycle   = true
# }

# module "secrets" {
#   source      = "./modules/secrets"
#   environment = var.environment
# }
