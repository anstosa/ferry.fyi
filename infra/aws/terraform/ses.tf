# Keep the Auth0 provider permission boundary explicit and testable.
locals {
  auth0_ses_actions = [
    "ses:SendEmail",
    "ses:SendRawEmail"
  ]
}

# Verify the Ferry FYI sender domain in the production SES region.
resource "aws_sesv2_email_identity" "auth0" {
  email_identity = var.ses_email_identity
  tags           = local.tags
}

# Isolate Auth0 email delivery from application and administrator credentials.
resource "aws_iam_user" "auth0_ses" {
  name = "${local.name_prefix}-auth0-ses"
  path = "/service-accounts/"
  tags = local.tags
}

# Keep development tenant credentials isolated from production delivery.
resource "aws_iam_user" "auth0_ses_dev" {
  name = "${local.name_prefix}-auth0-ses-dev"
  path = "/service-accounts/"
  tags = local.tags
}

# Limit Auth0 to sending from the verified Ferry FYI identity.
resource "aws_iam_user_policy" "auth0_ses" {
  name = "${local.name_prefix}-auth0-ses"
  user = aws_iam_user.auth0_ses.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SendAuth0Email"
        Effect   = "Allow"
        Action   = local.auth0_ses_actions
        Resource = aws_sesv2_email_identity.auth0.arn
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_default_from_address
          }
        }
      }
    ]
  })
}

# Apply the same sender boundary to the isolated development tenant user.
resource "aws_iam_user_policy" "auth0_ses_dev" {
  name = "${local.name_prefix}-auth0-ses-dev"
  user = aws_iam_user.auth0_ses_dev.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SendAuth0Email"
        Effect   = "Allow"
        Action   = local.auth0_ses_actions
        Resource = aws_sesv2_email_identity.auth0.arn
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_default_from_address
          }
        }
      }
    ]
  })
}
