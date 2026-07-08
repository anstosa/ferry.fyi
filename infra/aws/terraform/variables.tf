variable "aws_account_id" {
  description = "AWS account allowed to host the production stack."
  type        = string
  default     = "333401878534"
}

variable "aws_region" {
  description = "AWS region for the single production stack."
  type        = string
  default     = "us-west-2"
}

variable "project" {
  description = "Short project name used in resource names and tags."
  type        = string
  default     = "ferry-fyi"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prod"
}

variable "app_domains" {
  description = "DNS names requested on the ACM certificate. Cloudflare records remain manual."
  type        = list(string)
  default     = ["ferry.fyi", "staging.ferry.fyi"]
}

variable "enable_https_listener" {
  description = "Enable after ACM DNS validation is complete in Cloudflare."
  type        = bool
  # cert issued
  default = true
}

variable "base_url" {
  description = "Canonical app URL injected into the web and scheduler containers."
  type        = string
  default     = "https://ferry.fyi"
}

variable "container_port" {
  description = "Container port exposed by the Node web process."
  type        = number
  default     = 4040
}

variable "web_desired_count" {
  description = "Desired production web task count."
  type        = number
  default     = 1
}

variable "scheduler_desired_count" {
  description = "Desired singleton scheduler task count. Set to 0 to pause jobs."
  type        = number
  # pre-cutover paused
  default = 0
}

variable "web_cpu" {
  description = "Fargate CPU units for the web task."
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Fargate memory MiB for the web task."
  type        = number
  default     = 1024
}

variable "scheduler_cpu" {
  description = "Fargate CPU units for the scheduler task."
  type        = number
  default     = 512
}

variable "scheduler_memory" {
  description = "Fargate memory MiB for the scheduler task."
  type        = number
  default     = 1024
}

variable "image_tag" {
  description = "Docker image tag in the managed ECR repository."
  type        = string
  default     = "latest"
}

variable "vpc_cidr" {
  description = "CIDR block for the production VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs for ALB and public-IP ECS tasks."
  type        = list(string)
  default     = ["10.42.0.0/24", "10.42.1.0/24"]
}

variable "private_db_subnet_cidrs" {
  description = "Private subnet CIDRs for the RDS subnet group. No NAT route is created."
  type        = list(string)
  default     = ["10.42.10.0/24", "10.42.11.0/24"]
}

variable "rds_engine_version" {
  description = "PostgreSQL engine version. PostgreSQL 17.9 is available in us-west-2 as of G003 evidence."
  type        = string
  default     = "17.9"
}

variable "rds_instance_class" {
  description = "RDS instance class for the production PostgreSQL database."
  type        = string
  default     = "db.t4g.small"
}

variable "rds_allocated_storage" {
  description = "Initial RDS gp3 storage in GiB."
  type        = number
  default     = 20
}

variable "rds_max_allocated_storage" {
  description = "RDS storage autoscaling ceiling in GiB."
  type        = number
  default     = 100
}

variable "rds_database_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "ferryfyi"
}

variable "rds_username" {
  description = "Master PostgreSQL username."
  type        = string
  default     = "ferryfyi"
}

variable "rds_backup_retention_period" {
  description = "RDS automated backup retention in days."
  type        = number
  default     = 7
}

variable "rds_deletion_protection" {
  description = "Enable before production cutover. It may stay false for the initial create if AWS setup needs iteration."
  type        = bool
  default     = false
}

variable "rds_skip_final_snapshot" {
  description = "Whether RDS skips a final snapshot on destroy. Keep false for production-like teardown."
  type        = bool
  default     = false
}

variable "rds_final_snapshot_identifier" {
  description = "Optional final snapshot identifier to use if the database is destroyed with skip_final_snapshot=false."
  type        = string
  default     = null
}

variable "app_secret_keys" {
  description = "Manual Secrets Manager JSON keys exposed to ECS as environment secrets. Values are not managed here."
  type        = list(string)
  default = [
    "ANDROID_CERT_FINGERPRINT",
    "AUTH0_CLIENT_AUDIENCE",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_REDIRECT",
    "AUTH0_DOMAIN",
    "AUTH0_SERVER_AUDIENCE",
    "AUTH0_SERVER_ID",
    "AUTH0_SERVER_SECRET",
    "AW_TAG_ID",
    "FCM_PUBLIC_KEY",
    "FIREBASE_API_KEY",
    "FIREBASE_APP_ID",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_SENDER_ID",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_VAPID_KEY",
    "GCM_SENDER_ID",
    "GOOGLE_ANALYTICS",
    "GTM_CONTAINER_ID",
    "MAPBOX_ACCESS_TOKEN",
    "SENTRY_DSN",
    "WSDOT_API_KEY"
  ]
}

variable "create_app_secret_placeholder_version" {
  description = "Create a placeholder JSON version for the manual app secret. Disable to avoid placeholder values in Terraform state."
  type        = bool
  default     = false
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to assume the deployment role."
  type        = string
  default     = "anstosa/ferry.fyi"
}

variable "github_production_branch" {
  description = "GitHub branch allowed to assume the production deployment role."
  type        = string
  default     = "production"
}

variable "github_oidc_thumbprints" {
  description = "Thumbprints for the GitHub Actions OIDC provider. Re-check before first apply if AWS requires active thumbprints."
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
