data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  tags = {
    Application = "Ferry FYI"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = var.project
  }

  availability_zones = slice(data.aws_availability_zones.available.names, 0, max(length(var.public_subnet_cidrs), length(var.private_app_subnet_cidrs), length(var.private_db_subnet_cidrs)))

  image_uri = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

  detector_image_uri = "${aws_ecr_repository.detector.repository_url}:${var.detector_image_tag}"

  service_discovery_namespace = "${local.name_prefix}.internal"

  detector_endpoint = "http://${aws_service_discovery_service.detector.name}.${local.service_discovery_namespace}:${var.detector_container_port}/detect"

  web_environment = [
    { name = "BASE_URL", value = var.base_url },
    { name = "CAR_DETECTION_ENDPOINT", value = local.detector_endpoint },
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "PROCESS_ROLE", value = "web" },
    { name = "RUN_SCHEDULER", value = "false" }
  ]

  scheduler_environment = [
    { name = "BASE_URL", value = var.base_url },
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "PROCESS_ROLE", value = "scheduler" },
    { name = "RUN_SCHEDULER", value = "true" }
  ]

  app_secret_references = [
    for key in var.app_secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.app_config.arn}:${key}::"
    }
  ]

  database_url_secret_reference = {
    name      = "DATABASE_URL"
    valueFrom = aws_secretsmanager_secret.database_url.arn
  }

  container_secrets = concat(local.app_secret_references, [local.database_url_secret_reference])

  # shared web container
  web_container_definition = {
    name      = "web"
    image     = local.image_uri
    essential = true
    portMappings = [
      {
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }
    ]
    environment = local.web_environment
    secrets     = local.container_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }

  # tunnel sidecar
  cloudflare_tunnel_container_definition = {
    name      = "cloudflared"
    image     = var.cloudflare_tunnel_image
    essential = !var.enable_public_alb
    command = [
      "tunnel",
      "--no-autoupdate",
      "--loglevel",
      "info",
      "--metrics",
      "0.0.0.0:${var.cloudflare_tunnel_metrics_port}",
      "run"
    ]
    secrets = [
      {
        name      = "TUNNEL_TOKEN"
        valueFrom = aws_secretsmanager_secret.cloudflare_tunnel_token.arn
      }
    ]
    dependsOn = [
      {
        containerName = "web"
        condition     = "START"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }

  # optional tunnel list
  cloudflare_tunnel_container_definitions = var.enable_cloudflare_tunnel ? [local.cloudflare_tunnel_container_definition] : []

  github_oidc_sub = "repo:${var.github_repository}:ref:refs/heads/${var.github_production_branch}"
}

# preserve alb state
moved {
  from = aws_security_group.alb
  to   = aws_security_group.alb[0]
}

moved {
  from = aws_vpc_security_group_ingress_rule.alb_http
  to   = aws_vpc_security_group_ingress_rule.alb_http[0]
}

moved {
  from = aws_vpc_security_group_ingress_rule.alb_https
  to   = aws_vpc_security_group_ingress_rule.alb_https[0]
}

moved {
  from = aws_vpc_security_group_egress_rule.alb_to_ecs
  to   = aws_vpc_security_group_egress_rule.alb_to_ecs[0]
}

moved {
  from = aws_vpc_security_group_ingress_rule.ecs_from_alb
  to   = aws_vpc_security_group_ingress_rule.web_from_alb[0]
}

moved {
  from = aws_vpc_security_group_ingress_rule.detector_from_ecs
  to   = aws_vpc_security_group_ingress_rule.detector_from_web
}

moved {
  from = aws_lb.app
  to   = aws_lb.app[0]
}

moved {
  from = aws_lb_target_group.web
  to   = aws_lb_target_group.web[0]
}

moved {
  from = aws_lb_listener.http
  to   = aws_lb_listener.http[0]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  count = length(var.public_subnet_cidrs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = local.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  }
}

resource "aws_subnet" "private_app" {
  count = length(var.private_app_subnet_cidrs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.private_app_subnet_cidrs[count.index]
  availability_zone       = local.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-private-app-${count.index + 1}"
    Tier = "private-app"
  }
}

resource "aws_subnet" "private_db" {
  count = length(var.private_db_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_db_subnet_cidrs[count.index]
  availability_zone = local.availability_zones[count.index]

  tags = {
    Name = "${local.name_prefix}-private-db-${count.index + 1}"
    Tier = "private-db"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private_app" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-private-app"
  }
}

resource "aws_route_table_association" "private_app" {
  count = length(aws_subnet.private_app)

  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private_app.id
}

resource "aws_security_group" "alb" {
  # optional public ingress
  count = var.enable_public_alb ? 1 : 0

  name        = "${local.name_prefix}-alb"
  description = "Allow public HTTP and HTTPS ingress to the ALB."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  # optional http ingress
  count = var.enable_public_alb ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  # optional https ingress
  count = var.enable_public_alb ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  # optional alb egress
  count = var.enable_public_alb ? 1 : 0

  security_group_id            = aws_security_group.alb[0].id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = var.container_port
  ip_protocol                  = "tcp"
  to_port                      = var.container_port
}

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Allow ALB ingress and direct public-IP egress for the web service."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-web"
  }
}

resource "aws_vpc_security_group_egress_rule" "web_all_egress" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs"
  description = "Allow ALB ingress and direct public-IP egress for Fargate tasks."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-ecs"
  }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  # optional alb source
  count = var.enable_public_alb ? 1 : 0

  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb[0].id
  from_port                    = var.container_port
  ip_protocol                  = "tcp"
  to_port                      = var.container_port
}

resource "aws_vpc_security_group_egress_rule" "ecs_all_egress" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "detector" {
  name        = "${local.name_prefix}-detector"
  description = "Allow the Ferry FYI web ECS service to reach the detector service."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-detector"
  }
}

resource "aws_vpc_security_group_ingress_rule" "detector_from_web" {
  security_group_id            = aws_security_group.detector.id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = var.detector_container_port
  ip_protocol                  = "tcp"
  to_port                      = var.detector_container_port
}

resource "aws_vpc_security_group_egress_rule" "detector_to_vpc_endpoints" {
  security_group_id            = aws_security_group.detector.id
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  ip_protocol                  = "tcp"
  to_port                      = 443
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name_prefix}-vpc-endpoints"
  description = "Allow private detector tasks to reach AWS control-plane endpoints."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-vpc-endpoints"
  }
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_detector" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  referenced_security_group_id = aws_security_group.detector.id
  from_port                    = 443
  ip_protocol                  = "tcp"
  to_port                      = 443
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_web" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = 443
  ip_protocol                  = "tcp"
  to_port                      = 443
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Allow PostgreSQL only from ECS tasks."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-rds"
  }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_web" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "rds_all_egress" {
  security_group_id = aws_security_group.rds.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_ecr_repository" "app" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "detector" {
  name                 = "${local.name_prefix}-detector"
  image_tag_mutability = "MUTABLE"

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the most recent 30 production images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "detector" {
  repository = aws_ecr_repository.detector.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the most recent 30 detector images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_vpc_endpoint" "ecr_api" {
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  subnet_ids          = aws_subnet.private_app[*].id
  vpc_endpoint_type   = "Interface"
  vpc_id              = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-ecr-api"
  }
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  subnet_ids          = aws_subnet.private_app[*].id
  vpc_endpoint_type   = "Interface"
  vpc_id              = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-ecr-dkr"
  }
}

resource "aws_vpc_endpoint" "logs" {
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  subnet_ids          = aws_subnet.private_app[*].id
  vpc_endpoint_type   = "Interface"
  vpc_id              = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-logs"
  }
}

resource "aws_vpc_endpoint" "s3" {
  route_table_ids   = [aws_route_table.private_app.id]
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  vpc_id            = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-s3"
  }
}

resource "aws_vpc_security_group_egress_rule" "detector_to_s3_gateway" {
  security_group_id = aws_security_group.detector.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_acm_certificate" "app" {
  domain_name               = var.app_domains[0]
  subject_alternative_names = slice(var.app_domains, 1, length(var.app_domains))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_lb" "app" {
  # optional public alb
  count = var.enable_public_alb ? 1 : 0

  name               = local.name_prefix
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = aws_subnet.public[*].id

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_lb_target_group" "web" {
  # optional web target group
  count = var.enable_public_alb ? 1 : 0

  name        = "${local.name_prefix}-web"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/healthz"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name_prefix}-web"
  }
}

resource "aws_lb_listener" "http" {
  # optional http listener
  count = var.enable_public_alb ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    # forward before cert
    for_each = var.enable_https_listener ? [] : [1]

    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web[0].arn
    }
  }

  dynamic "default_action" {
    # redirect after cert
    for_each = var.enable_https_listener ? [1] : []

    content {
      type = "redirect"

      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  # optional https listener
  count = var.enable_public_alb && var.enable_https_listener ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.app.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web[0].arn
  }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "scheduler" {
  name              = "/ecs/${local.name_prefix}/scheduler"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "detector" {
  name              = "/ecs/${local.name_prefix}/detector"
  retention_in_days = 30
}

resource "aws_service_discovery_private_dns_namespace" "app" {
  name = local.service_discovery_namespace
  vpc  = aws_vpc.main.id

  tags = {
    Name = local.service_discovery_namespace
  }
}

resource "aws_service_discovery_service" "detector" {
  name = "detector"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.app.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }
}

resource "aws_ecs_cluster" "app" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name_prefix}-ecs-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadManagedSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.app_config.arn,
          aws_secretsmanager_secret.cloudflare_tunnel_token.arn,
          aws_secretsmanager_secret.database_url.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode(concat([local.web_container_definition], local.cloudflare_tunnel_container_definitions))
}

resource "aws_ecs_task_definition" "detector" {
  family                   = "${local.name_prefix}-detector"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.detector_cpu
  memory                   = var.detector_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "detector"
      image     = local.detector_image_uri
      essential = true
      portMappings = [
        {
          containerPort = var.detector_container_port
          hostPort      = var.detector_container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "DETECTOR_MODEL", value = "/app/models/yolov8n.pt" },
        { name = "PORT", value = tostring(var.detector_container_port) }
      ]
      healthCheck = {
        command = [
          "CMD-SHELL",
          "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:${var.detector_container_port}/ready', timeout=5).read()\""
        ]
        interval    = 30
        retries     = 3
        startPeriod = 30
        timeout     = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.detector.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "scheduler" {
  family                   = "${local.name_prefix}-scheduler"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.scheduler_cpu
  memory                   = var.scheduler_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name        = "scheduler"
      image       = local.image_uri
      essential   = true
      environment = local.scheduler_environment
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.scheduler.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  # alb-only grace
  health_check_grace_period_seconds = var.enable_public_alb ? 60 : null

  # optional service attachment
  dynamic "load_balancer" {
    for_each = var.enable_public_alb ? [1] : []

    content {
      target_group_arn = aws_lb_target_group.web[0].arn
      container_name   = "web"
      container_port   = var.container_port
    }
  }

  network_configuration {
    assign_public_ip = true
    security_groups  = [aws_security_group.web.id]
    subnets          = aws_subnet.public[*].id
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "detector" {
  name            = "${local.name_prefix}-detector"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.detector.arn
  desired_count   = var.detector_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    assign_public_ip = false
    security_groups  = [aws_security_group.detector.id]
    subnets          = aws_subnet.private_app[*].id
  }

  service_registries {
    registry_arn = aws_service_discovery_service.detector.arn
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "scheduler" {
  name            = "${local.name_prefix}-scheduler"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.scheduler.arn
  desired_count   = var.scheduler_desired_count
  launch_type     = "FARGATE"

  # stop before start
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    assign_public_ip = true
    security_groups  = [aws_security_group.ecs.id]
    subnets          = aws_subnet.public[*].id
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_db_subnet_group" "app" {
  name       = local.name_prefix
  subnet_ids = aws_subnet.private_db[*].id

  tags = {
    Name = local.name_prefix
  }
}

resource "random_password" "rds" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_parameter_group" "app" {
  name   = "${local.name_prefix}-postgres17"
  family = "postgres17"

  tags = {
    Name = "${local.name_prefix}-postgres17"
  }
}

resource "aws_db_instance" "app" {
  identifier = local.name_prefix

  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = var.rds_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  db_name  = var.rds_database_name
  username = var.rds_username
  password = random_password.rds.result

  backup_retention_period = var.rds_backup_retention_period
  backup_window           = "10:00-11:00"
  maintenance_window      = "sun:11:00-sun:12:00"

  db_subnet_group_name   = aws_db_subnet_group.app.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  deletion_protection       = var.rds_deletion_protection
  final_snapshot_identifier = var.rds_final_snapshot_identifier
  parameter_group_name      = aws_db_parameter_group.app.name
  skip_final_snapshot       = var.rds_skip_final_snapshot

  apply_immediately = false

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "/${var.project}/${var.environment}/DATABASE_URL"
  description = "Generated PostgreSQL connection string for Ferry FYI ${var.environment}."
}

# remote tunnel token
resource "aws_secretsmanager_secret" "cloudflare_tunnel_token" {
  name        = "/${var.project}/${var.environment}/CLOUDFLARE_TUNNEL_TOKEN"
  description = "Remote-managed Cloudflare Tunnel token for Ferry FYI ${var.environment}."
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://%s:%s@%s:%s/%s?sslmode=require&uselibpqcompat=true",
    var.rds_username,
    urlencode(random_password.rds.result),
    aws_db_instance.app.address,
    aws_db_instance.app.port,
    var.rds_database_name
  )
}

resource "aws_secretsmanager_secret" "app_config" {
  name        = "/${var.project}/${var.environment}/app-config"
  description = "Manual JSON secret for Ferry FYI ${var.environment} runtime keys."
}

resource "aws_secretsmanager_secret_version" "app_config_placeholder" {
  count = var.create_app_secret_placeholder_version ? 1 : 0

  secret_id     = aws_secretsmanager_secret.app_config.id
  secret_string = jsonencode({ for key in var.app_secret_keys : key => "REPLACE_ME" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_ssm_parameter" "base_url" {
  name        = "/${var.project}/${var.environment}/config/BASE_URL"
  description = "Canonical Ferry FYI base URL for ${var.environment}."
  type        = "String"
  value       = var.base_url
}

resource "aws_ssm_parameter" "ecr_repository_url" {
  name        = "/${var.project}/${var.environment}/deploy/ECR_REPOSITORY_URL"
  description = "ECR repository URL for Ferry FYI ${var.environment} image pushes."
  type        = "String"
  value       = aws_ecr_repository.app.repository_url
}

resource "aws_ssm_parameter" "detector_ecr_repository_url" {
  name        = "/${var.project}/${var.environment}/deploy/DETECTOR_ECR_REPOSITORY_URL"
  description = "ECR repository URL for Ferry FYI ${var.environment} detector image pushes."
  type        = "String"
  value       = aws_ecr_repository.detector.repository_url
}

resource "aws_ssm_parameter" "ecs_cluster_name" {
  name        = "/${var.project}/${var.environment}/deploy/ECS_CLUSTER_NAME"
  description = "ECS cluster name for Ferry FYI ${var.environment} deployments."
  type        = "String"
  value       = aws_ecs_cluster.app.name
}

resource "aws_ssm_parameter" "web_service_name" {
  name        = "/${var.project}/${var.environment}/deploy/WEB_SERVICE_NAME"
  description = "ECS web service name for Ferry FYI ${var.environment} deployments."
  type        = "String"
  value       = aws_ecs_service.web.name
}

resource "aws_ssm_parameter" "scheduler_service_name" {
  name        = "/${var.project}/${var.environment}/deploy/SCHEDULER_SERVICE_NAME"
  description = "ECS scheduler service name for Ferry FYI ${var.environment} deployments."
  type        = "String"
  value       = aws_ecs_service.scheduler.name
}

resource "aws_ssm_parameter" "detector_service_name" {
  name        = "/${var.project}/${var.environment}/deploy/DETECTOR_SERVICE_NAME"
  description = "ECS detector service name for Ferry FYI ${var.environment} deployments."
  type        = "String"
  value       = aws_ecs_service.detector.name
}
