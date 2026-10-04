mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-west-2a", "us-west-2b"]
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "333401878534"
    }
  }
}

mock_provider "random" {}

run "web_runtime_contract" {
  command = plan

  variables {
    enable_public_alb = true
  }

  assert {
    condition     = !contains(var.app_secret_keys, "GOOGLE_ROUTES_TERMINAL_ACCESS_POINTS") && contains(var.app_secret_keys, "GOOGLE_ROUTES_API_KEY") && contains(var.app_secret_keys, "GOOGLE_ROUTES_ENABLED")
    error_message = "Routing must use persisted admin booths, not a competing modal-entrance secret."
  }

  # keep places credentials in the server secret boundary
  assert {
    condition     = contains(var.app_secret_keys, "GOOGLE_PLACES_API_KEY") && contains(var.app_secret_keys, "GOOGLE_PLACES_ENABLED") && length([for item in local.container_secrets : item if item.name == "GOOGLE_PLACES_API_KEY"]) == 1
    error_message = "Places credentials and the disabled runtime gate must be injectable through ECS app-config secrets."
  }

  assert {
    condition     = local.web_container_definition.stopTimeout > 25
    error_message = "ECS stopTimeout must exceed the application drain deadline."
  }

  assert {
    condition     = strcontains(local.web_container_definition.healthCheck.command[1], "/healthz")
    error_message = "Container liveness must remain on /healthz."
  }

  assert {
    condition     = aws_lb_target_group.web[0].health_check[0].path == "/readyz"
    error_message = "The optional ALB must route on /readyz."
  }

  assert {
    condition     = aws_ecs_service.web.deployment_circuit_breaker[0].enable && !aws_ecs_service.web.deployment_circuit_breaker[0].rollback
    error_message = "Circuit-breaker detection must be enabled without unsafe automatic rollback."
  }

  assert {
    condition     = aws_iam_role.web_task.name == "${local.name_prefix}-web-task" && aws_iam_role.ecs_task.name == "${local.name_prefix}-ecs-task"
    error_message = "Web and detector task roles must remain distinct before Google WIF is enabled."
  }

  assert {
    condition     = aws_iam_role_policy.ecs_task_ota_release_index.name == "${local.name_prefix}-web-task-ota-release-index"
    error_message = "The OTA release-pointer policy must remain web-task specific."
  }

  assert {
    condition     = length([for item in local.web_environment : item if startswith(item.name, "GOOGLE_")]) == 0
    error_message = "Google WIF environment must remain disabled by default until external gates pass."
  }

  assert {
    condition     = aws_sesv2_email_identity.auth0.email_identity == "ferry.fyi"
    error_message = "Auth0 email must use the Ferry FYI SES identity."
  }

  assert {
    condition     = aws_iam_user.auth0_ses.name == "ferry-fyi-prod-auth0-ses"
    error_message = "Production Auth0 SES delivery must use its dedicated IAM user."
  }

  assert {
    condition     = aws_iam_user.auth0_ses_dev.name == "ferry-fyi-prod-auth0-ses-dev"
    error_message = "Development Auth0 SES delivery must use a separate IAM user."
  }

  assert {
    condition     = toset(local.auth0_ses_actions) == toset(["ses:SendEmail", "ses:SendRawEmail"])
    error_message = "Auth0's IAM policy must include both SES send actions."
  }

  assert {
    condition     = aws_iam_user_policy.auth0_ses.user != aws_iam_user_policy.auth0_ses_dev.user
    error_message = "Development and production Auth0 tenants must not share SES credentials."
  }
}

run "google_operations_reject_empty_configuration" {
  command = plan
  variables {
    google_routes_operations_enabled = true
  }
  expect_failures = [var.google_routes_operations_enabled]
}

run "google_operations_enable_configured_federation" {
  command = plan
  variables {
    google_routes_operations_enabled  = true
    google_monitoring_project_id      = "ferry-monitoring-test"
    google_workload_identity_provider = "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/ferry-test/providers/aws-web"
  }
  assert {
    condition     = length([for item in local.web_environment : item if startswith(item.name, "GOOGLE_")]) == 2
    error_message = "Configured federation must inject both exporter identifiers."
  }
}
