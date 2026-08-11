output "account_id" {
  description = "AWS account seen by Terraform."
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "AWS region used by the provider."
  value       = var.aws_region
}

output "ses_email_identity" {
  description = "SES domain identity used by Auth0 account email."
  value       = aws_sesv2_email_identity.auth0.email_identity
}

output "ses_default_from_address" {
  description = "From address to configure on the Auth0 SES provider."
  value       = var.ses_default_from_address
}

output "ses_dkim_records" {
  description = "DNS-only CNAME records required to verify the SES domain in Cloudflare."
  value = try({
    for token in aws_sesv2_email_identity.auth0.dkim_signing_attributes[0].tokens :
    "${token}._domainkey.${var.ses_email_identity}" => "${token}.dkim.amazonses.com"
  }, {})
}

output "auth0_ses_iam_user_name" {
  description = "Production Auth0 IAM user whose access key is stored only in Auth0."
  value       = aws_iam_user.auth0_ses.name
}

output "auth0_ses_dev_iam_user_name" {
  description = "Development Auth0 IAM user whose access key is stored only in Auth0."
  value       = aws_iam_user.auth0_ses_dev.name
}

output "ecr_repository_url" {
  description = "Docker image repository URL for CI builds."
  value       = aws_ecr_repository.app.repository_url
}

output "detector_ecr_repository_url" {
  description = "Detector Docker image repository URL for CI builds."
  value       = aws_ecr_repository.detector.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS target for manual Cloudflare CNAME records."
  value       = var.enable_public_alb ? aws_lb.app[0].dns_name : null
}

output "alb_zone_id" {
  description = "ALB hosted zone id for alias-capable DNS tooling."
  value       = var.enable_public_alb ? aws_lb.app[0].zone_id : null
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

output "detector_service_name" {
  description = "ECS detector service name."
  value       = aws_ecs_service.detector.name
}

output "web_task_definition_family" {
  description = "ECS web task definition family for GitHub Actions render/deploy."
  value       = aws_ecs_task_definition.web.family
}

output "detector_task_definition_family" {
  description = "ECS detector task definition family for GitHub Actions render/deploy."
  value       = aws_ecs_task_definition.detector.family
}

output "detector_endpoint" {
  description = "Private detector URL injected into the web task as CAR_DETECTION_ENDPOINT."
  value       = local.detector_endpoint
}

output "ecs_task_subnet_ids" {
  description = "Public subnet IDs for one-off GitHub Actions ECS migration tasks."
  value       = aws_subnet.public[*].id
}

output "ecs_task_security_group_id" {
  description = "ECS security group ID for one-off GitHub Actions ECS migration tasks."
  value       = aws_security_group.ecs.id
}

output "web_security_group_id" {
  description = "Web ECS service security group ID."
  value       = aws_security_group.web.id
}

output "detector_task_subnet_ids" {
  description = "Public subnet IDs used by the locked-down detector ECS service."
  value       = aws_subnet.public[*].id
}

output "detector_security_group_id" {
  description = "Detector security group ID."
  value       = aws_security_group.detector.id
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

output "cloudflare_tunnel_token_secret_arn" {
  description = "Secrets Manager secret ARN for the remote-managed Cloudflare Tunnel token."
  value       = aws_secretsmanager_secret.cloudflare_tunnel_token.arn
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deployments from the production branch."
  value       = aws_iam_role.github_deploy.arn
}

output "ota_bucket_name" {
  description = "Private versioned S3 bucket used by the OTA publisher."
  value       = aws_s3_bucket.ota_artifacts.bucket
}

output "ota_distribution_id" {
  description = "CloudFront distribution ID for OTA cache invalidations."
  value       = aws_cloudfront_distribution.ota.id
}

output "ota_distribution_domain" {
  description = "CloudFront hostname serving OTA artifacts over HTTPS."
  value       = aws_cloudfront_distribution.ota.domain_name
}

output "ota_distribution_url" {
  description = "HTTPS base URL for OTA artifacts."
  value       = "https://${aws_cloudfront_distribution.ota.domain_name}"
}

output "ota_bundle_base_url" {
  description = "HTTPS base URL for immutable OTA bundles."
  value       = "https://${aws_cloudfront_distribution.ota.domain_name}/bundles"
}

output "ota_channel_release_base_url" {
  description = "HTTPS base URL for mutable per-channel OTA release JSON."
  value       = "https://${aws_cloudfront_distribution.ota.domain_name}/channels"
}

output "ota_releases_url" {
  description = "HTTPS URL for the mutable OTA release index consumed by the application API."
  value       = "https://${aws_cloudfront_distribution.ota.domain_name}/releases.json"
}
