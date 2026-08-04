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
}
