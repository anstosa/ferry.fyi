resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprints
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.name_prefix}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = local.github_oidc_sub
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "${local.name_prefix}-github-deploy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GetEcrAuthorizationToken"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "PushApplicationImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Sid    = "RegisterTaskDefinitions"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition"
        ]
        Resource = "*"
      },
      {
        Sid    = "UpdateProductionServices"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:UpdateService"
        ]
        Resource = [
          aws_ecs_service.web.arn,
          aws_ecs_service.scheduler.arn
        ]
      },
      {
        Sid    = "RunMigrationTask"
        Effect = "Allow"
        Action = [
          "ecs:RunTask"
        ]
        Resource = "${aws_ecs_task_definition.web.arn_without_revision}:*"
        Condition = {
          ArnEquals = {
            "ecs:cluster" = aws_ecs_cluster.app.arn
          }
        }
      },
      {
        Sid    = "InspectMigrationTask"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTasks"
        ]
        Resource = "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.app.name}/*"
      },
      {
        Sid    = "PassTaskRolesToEcs"
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.ecs_task.arn,
          aws_iam_role.ecs_task_execution.arn
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      }
    ]
  })
}
