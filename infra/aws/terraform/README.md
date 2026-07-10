# Ferry FYI production AWS Terraform

This directory defines the single production AWS stack for Ferry FYI in account `333401878534`, region `us-west-2`.
It is intentionally small and reviewable: no third-party Terraform modules, no NAT gateway, optional public ALB, public-IP web/scheduler ECS tasks, a private internal detector ECS task, optional Cloudflare Tunnel sidecar, and private RDS subnets.

## What it creates

- ECR repositories for the app image and detector image.
- VPC with two public subnets, two private app subnets, two private DB subnets, an internet gateway, private AWS endpoints for detector image pulls/logs, and no NAT gateway.
- Optional public ALB with `/healthz` target-group checks on container port `4040`.
- ACM DNS-validated certificate outputs for manual Cloudflare records.
- ECS Fargate cluster, web service, singleton scheduler service, and always-on private detector service.
- Web task env: `PROCESS_ROLE=web`, `RUN_SCHEDULER=false`, and `CAR_DETECTION_ENDPOINT` pointing at private Cloud Map service discovery.
- Optional `cloudflared` sidecar in the web task for Cloudflare Tunnel ingress.
- Scheduler task env: `PROCESS_ROLE=scheduler`, `RUN_SCHEDULER=true`.
- Detector task: CPU-only Fargate, desired count 1, no public IP, no public ALB/listener/target group, and ingress allowed only from the web ECS service security group.
- RDS PostgreSQL `17.9` by default, `db.t4g.small`, Single-AZ, gp3 20 GiB with autoscaling, 7-day backups.
- Secrets Manager plumbing for generated `DATABASE_URL` and manual app config keys.
- SSM String parameters for non-secret deployment metadata such as base URL, ECR URL, and ECS service names.
- Least-privilege GitHub OIDC deploy role for `anstosa/ferry.fyi` `production` branch only.

## First apply sequence

Do not run `terraform apply` from automation until the plan has been reviewed.

```sh
terraform init
terraform plan -out tfplan
```

After the initial infrastructure is created, copy `acm_validation_records` into Cloudflare manually.
When ACM is issued, set `enable_https_listener = true` and plan/apply that listener change.
Point `staging.ferry.fyi` to `alb_dns_name`; later add `ferry.fyi` and `www.ferry.fyi` to `app_domains` and repeat ACM validation.

## Secrets

Terraform creates the app config secret container but does not create placeholder values by default.
Populate the JSON secret shown by `app_config_secret_arn` manually before starting ECS tasks.
Expected keys are controlled by `var.app_secret_keys` and include runtime Auth0, Firebase, Mapbox, Sentry DSN, and WSDOT settings. `SENTRY_AUTH_TOKEN` is build-only for optional sourcemap upload and must not be imported into this ECS runtime secret.

Terraform does create a generated `DATABASE_URL` secret from the RDS endpoint and generated password.
The secret value is sensitive and will be present in Terraform state; store state in a protected backend before production use.

If you want Terraform to create an initial all-`REPLACE_ME` JSON version for the app config secret, set:

```hcl
create_app_secret_placeholder_version = true
```

Then replace the secret value manually in AWS Secrets Manager before running services.

## Cloudflare Tunnel cutover

The production default uses Cloudflare Tunnel and leaves the ALB disabled to avoid fixed ALB and ALB public IPv4 charges.
For rollback-safe changes, re-enable the ALB temporarily and use Cloudflare Tunnel in two phases:

1. Create a remotely-managed Cloudflare Tunnel for `ferry.fyi`.
2. Configure the tunnel public hostname in Cloudflare to route `ferry.fyi` to `http://localhost:4040`.
3. Store the tunnel token in the Terraform-managed secret:

   ```sh
   aws secretsmanager put-secret-value \
     --region us-west-2 \
     --secret-id /ferry-fyi/prod/CLOUDFLARE_TUNNEL_TOKEN \
     --secret-string '<TUNNEL_TOKEN>'
   ```

4. Set `enable_cloudflare_tunnel = true`, apply Terraform, and deploy the web service so the `cloudflared` sidecar starts.
5. Confirm the Cloudflare tunnel is healthy and `https://ferry.fyi/healthz` returns `ok`.
6. Set `enable_public_alb = false`, apply Terraform, and leave Cloudflare DNS pointing at the tunnel route.

Keep `enable_public_alb = true` only while proving or rolling back the tunnel connector; disabling it removes the ALB, ALB security group ingress path, target group attachment, and listener resources.

## RDS notes

PostgreSQL `17.9` is the default because read-only G003 evidence confirmed it is available in `us-west-2` with the `postgres17` parameter family.
If AWS availability changes, check with:

```sh
aws rds describe-db-engine-versions \
  --region us-west-2 \
  --engine postgres \
  --engine-version 17.9
```

`rds_deletion_protection` defaults to `false` to allow initial create iteration, but set it to `true` before cutover.

## GitHub OIDC

The trust policy uses `StringEquals` for both:

- `token.actions.githubusercontent.com:aud = sts.amazonaws.com`
- `token.actions.githubusercontent.com:sub = repo:anstosa/ferry.fyi:ref:refs/heads/production`

The identity policy has no `Principal` and is scoped to the ECR repository, ECS services, and ECS task roles except for AWS-required wildcard actions such as ECR auth token and ECS task-definition registration.

## GitHub Actions deployment variables

The production deployment workflow is `.github/workflows/deploy-aws.yml`.
It runs only from the `production` branch or manual `workflow_dispatch`, assumes the `github_deploy_role_arn` role through OIDC, pushes immutable image tags to the app and detector ECR repositories, runs `yarn db:migrate` as a one-off ECS task, then updates the web, detector, and scheduler services.

The workflow builds the CPU-only detector image from `detector-runtime` by default, using `detector-runtime/Dockerfile`. The detector runtime listens on `detector_container_port`, which defaults to `8000`, and accepts the web service's raw image POST contract.

Configure these non-secret GitHub variables at the repository or organization level before enabling the workflow. Do not set `environment: production` on this workflow for the current branch-scoped trust because that changes the GitHub OIDC `sub` claim. If a GitHub Environment is added later, change the IAM `sub` condition to `repo:anstosa/ferry.fyi:environment:production` and enforce branch restrictions in the Environment settings:

| Variable | Source |
| --- | --- |
| `AWS_REGION` | `region` output, expected `us-west-2` |
| `AWS_ROLE_ARN` | `github_deploy_role_arn` output |
| `AUTH0_CLIENT_AUDIENCE` | Browser Auth0 audience from Heroku config classification or Auth0 public app config |
| `AUTH0_CLIENT_ID` | Browser Auth0 client ID from Heroku config classification or Auth0 public app config |
| `AUTH0_CLIENT_REDIRECT` | Browser Auth0 redirect URL for the deployed hostname |
| `AUTH0_DOMAIN` | Browser Auth0 domain from Heroku config classification or Auth0 public app config |
| `AW_TAG_ID` | Browser Ads conversion tag ID if enabled |
| `BASE_URL` | Production public URL, usually the Terraform `base_url` value |
| `DETECTOR_CONTEXT` | Optional detector Docker build context; defaults to `detector-runtime` when unset |
| `DETECTOR_DOCKERFILE` | Optional detector Dockerfile path; defaults to `detector-runtime/Dockerfile` when unset |
| `DETECTOR_ECR_REPOSITORY_URL` | `detector_ecr_repository_url` output |
| `ECR_REPOSITORY_URL` | `ecr_repository_url` output |
| `ECS_CLUSTER` | `ecs_cluster_name` output |
| `ECS_WEB_SERVICE` | `web_service_name` output |
| `ECS_SCHEDULER_SERVICE` | `scheduler_service_name` output |
| `ECS_DETECTOR_SERVICE` | `detector_service_name` output |
| `ECS_WEB_TASK_DEFINITION_FAMILY` | `web_task_definition_family` output |
| `ECS_SCHEDULER_TASK_DEFINITION_FAMILY` | `scheduler_task_definition_family` output |
| `ECS_DETECTOR_TASK_DEFINITION_FAMILY` | `detector_task_definition_family` output |
| `ECS_TASK_SUBNETS` | Comma-separated `ecs_task_subnet_ids` output |
| `ECS_TASK_SECURITY_GROUPS` | `ecs_task_security_group_id` output |
| `FIREBASE_API_KEY` | Browser Firebase API key from Heroku config classification or Firebase public app config |
| `FIREBASE_APP_ID` | Browser Firebase app ID from Heroku config classification or Firebase public app config |
| `FIREBASE_PROJECT_ID` | Browser Firebase project ID from Heroku config classification or Firebase public app config |
| `FIREBASE_SENDER_ID` | Browser Firebase sender ID from Heroku config classification or Firebase public app config |
| `FIREBASE_VAPID_KEY` | Browser Firebase VAPID public key from Heroku config classification or Firebase public app config |
| `GOOGLE_ANALYTICS` | Browser Google Analytics ID if enabled |
| `GTM_CONTAINER_ID` | Browser Google Tag Manager container ID if enabled |
| `LOG_LEVEL` | Browser log-level override if needed |
| `MAPBOX_ACCESS_TOKEN` | Browser Mapbox public token from Heroku config classification or Mapbox public token config |
| `SENTRY_DSN` | Browser Sentry DSN if enabled |

Keep application runtime secrets in AWS Secrets Manager.
Do not copy `DATABASE_URL`, Firebase service account JSON, Auth0 server secret, WSDOT API key, or `SENTRY_AUTH_TOKEN` into GitHub variables for ECS runtime deployment. If sourcemap upload is enabled later, store `SENTRY_AUTH_TOKEN` only as a GitHub build secret and do not pass it to ECS runtime.

The scheduler ECS service is intentionally configured with `deployment_minimum_healthy_percent = 0` and `deployment_maximum_percent = 100` so rolling deploys stop the singleton scheduler before starting the replacement task. Preserve this invariant while `scheduler_desired_count = 1` to avoid overlapping refresh jobs.
