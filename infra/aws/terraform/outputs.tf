output "account_id" {
  description = "AWS account seen by Terraform."
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "AWS region used by the provider."
  value       = var.aws_region
}

output "ecr_repository_url" {
  description = "Docker image repository URL for CI builds."
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS target for manual Cloudflare CNAME records."
  value       = aws_lb.app.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone id for alias-capable DNS tooling."
  value       = aws_lb.app.zone_id
}

output "acm_validation_records" {
  description = "Create these DNS validation records manually in Cloudflare."
  value = {
    for option in aws_acm_certificate.app.domain_validation_options : option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.app.name
}

output "web_service_name" {
  description = "ECS web service name."
  value       = aws_ecs_service.web.name
}

output "scheduler_service_name" {
  description = "ECS scheduler service name."
  value       = aws_ecs_service.scheduler.name
}

output "web_task_definition_family" {
  description = "ECS web task definition family for GitHub Actions render/deploy."
  value       = aws_ecs_task_definition.web.family
}

output "scheduler_task_definition_family" {
  description = "ECS scheduler task definition family for GitHub Actions render/deploy."
  value       = aws_ecs_task_definition.scheduler.family
}

output "ecs_task_subnet_ids" {
  description = "Public subnet IDs for one-off GitHub Actions ECS migration tasks."
  value       = aws_subnet.public[*].id
}

output "ecs_task_security_group_id" {
  description = "ECS security group ID for one-off GitHub Actions ECS migration tasks."
  value       = aws_security_group.ecs.id
}

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint."
  value       = aws_db_instance.app.endpoint
}

output "database_url_secret_arn" {
  description = "Secrets Manager secret ARN containing the generated DATABASE_URL."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "app_config_secret_arn" {
  description = "Secrets Manager secret ARN for manual runtime config JSON."
  value       = aws_secretsmanager_secret.app_config.arn
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deployments from the production branch."
  value       = aws_iam_role.github_deploy.arn
}
