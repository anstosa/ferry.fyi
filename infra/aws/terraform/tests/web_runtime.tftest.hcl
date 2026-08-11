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
