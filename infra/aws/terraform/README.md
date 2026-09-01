# Ferry FYI production AWS Terraform

This directory defines the single production AWS stack for Ferry FYI in account `333401878534`, region `us-west-2`.
It is intentionally small and reviewable: no third-party Terraform modules, no NAT gateway, optional public ALB, public-IP ECS tasks, a security-group-isolated internal detector service, optional Cloudflare Tunnel sidecar, and private RDS subnets.

## What it creates

- ECR repositories for the app image and detector image.
- VPC with two public subnets, two reserved private app subnets, two private DB subnets, an internet gateway, a free S3 gateway endpoint, and no NAT gateway.
- Optional public ALB with `/readyz` target-group checks on container port `4040`; ECS container liveness remains `/healthz`.
- ACM DNS-validated certificate outputs for manual Cloudflare records.
- ECS Fargate cluster without paid Container Insights, a singleton ARM64 web service, and an always-on x86 detector service.
- Web task env: `PROCESS_ROLE=web`, `RUN_SCHEDULER=true`, and `CAR_DETECTION_ENDPOINT` pointing at private Cloud Map service discovery. The web process owns route notifications and recurring refresh jobs.
- Optional `cloudflared` sidecar in the web task for Cloudflare Tunnel ingress.
- Detector task: CPU-only Fargate, desired count 1, public-subnet egress, no public ALB/listener/target group, and ingress allowed only from the web ECS service security group.
- RDS PostgreSQL `17.9` by default, `db.t4g.small`, Single-AZ, gp3 20 GiB with autoscaling, 7-day backups.
- Secrets Manager plumbing for generated `DATABASE_URL` and manual app config keys.
- SSM String parameters for non-secret deployment metadata such as base URL, ECR URL, and ECS service names.
- Least-privilege GitHub OIDC deploy role for `anstosa/ferry.fyi` `production` branch only.
- Private, versioned, AES-256 encrypted S3 storage for OTA bundles and release JSON, with all public S3 access blocked.
- CloudFront OTA delivery with SigV4 Origin Access Control, HTTPS redirects, a one-year immutable bundle cache, and a short release-JSON cache.
- Amazon SES domain verification and a dedicated least-privilege IAM user for Auth0 account email.

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

Set `FORECAST_DEMAND_SHOCK_MODE` to `on` in the production app-config secret so
recent direction-specific and same-day demand adjustments affect selected
forecasts rather than running only for comparison telemetry.

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

`/readyz` does not remove traffic in the production-default Cloudflare Tunnel
topology. It is an observable synthetic signal there. Only the optional ALB
uses readiness for target routing. The web task allows 30 seconds for ECS stop,
strictly longer than the application's 25-second drain deadline.

The ECS deployment circuit breaker detects failed deployments but automatic
rollback is disabled. Database migrations run before service deployment, so an
old task revision may be unsafe after a migration. Use the deployment workflow's
captured task definitions, image digests, and migration-file range for a
compatibility review before operator recovery.

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

It also permits the production branch to publish, inspect, and multipart-upload only OTA objects under `bundles/*`, `channels/*`, and `releases.json`. It does not permit deletion. `cloudfront:CreateInvalidation` is scoped to the OTA distribution only.

## OTA publishing

The OTA bucket is private: CloudFront is the only principal granted `s3:GetObject` by its bucket policy, and it must originate from the generated distribution. Do not grant public bucket access or use the S3 website endpoint.

The generated `*.cloudfront.net` hostname uses CloudFront's default certificate. AWS fixes that certificate's minimum viewer policy at TLSv1, even when Terraform requests a newer policy. To require TLS 1.2 or later, use a dedicated OTA hostname with a DNS-validated ACM certificate in `us-east-1`, then configure that hostname as a CloudFront alias. Do not claim a stricter policy while publishing through the default hostname.

Publish immutable ZIP bundles below `bundles/`, per-channel mutable JSON below `channels/`, and the aggregate mutable release index at `releases.json`. For example:

```text
bundles/1.2.3/ferry-fyi-1.2.3.zip
channels/production.json
releases.json
```

After an apply, configure OTA publishing with these Terraform outputs:

| Publisher value | Terraform output |
| --- | --- |
| `OTA_BUCKET_NAME` | `ota_bucket_name` |
| `OTA_DISTRIBUTION_DOMAIN` | `ota_distribution_domain` |
| CloudFront invalidation target | `ota_distribution_id` |
| Immutable bundle URL prefix | `ota_bundle_base_url` |
| Channel JSON URL prefix | `ota_channel_release_base_url` |
| Application `OTA_RELEASES_URL` | `ota_releases_url` |

Use the CloudFront HTTPS URLs in release JSON; do not expose S3 object URLs. Bundles have a one-year CloudFront TTL because their object keys must be immutable. `channels/*.json` and `releases.json` use `ota_release_cache_ttl_seconds`, which defaults to five minutes; invalidate the affected paths after a channel promotion when an immediate rollout is required.

## GitHub Actions deployment variables

The production deployment workflow is `.github/workflows/deploy-aws.yml`.
It runs only from the `production` branch or manual `workflow_dispatch`, assumes the `github_deploy_role_arn` role through OIDC, pushes immutable image tags to the app and detector ECR repositories, runs `yarn db:migrate` as a one-off ECS task, then updates the web and detector services.

The workflow builds the application image for ARM64 and the CPU-only detector image for x86_64 from `detector-runtime` by default, using `detector-runtime/Dockerfile`. The detector runtime listens on `detector_container_port`, which defaults to `8000`, and accepts the web service's raw image POST contract.

Configure these non-secret GitHub variables at the repository or organization level before enabling the workflow. Do not set `environment: production` on this workflow for the current branch-scoped trust because that changes the GitHub OIDC `sub` claim. If a GitHub Environment is added later, change the IAM `sub` condition to `repo:anstosa/ferry.fyi:environment:production` and enforce branch restrictions in the Environment settings:

| Variable | Source |
| --- | --- |
| `AWS_REGION` | `region` output, expected `us-west-2` |
| `AWS_ROLE_ARN` | `github_deploy_role_arn` output |
| `AUTH0_CLIENT_AUDIENCE` | Browser Auth0 audience from Auth0 public app config |
| `AUTH0_CLIENT_ID` | Browser Auth0 client ID from Auth0 public app config |
| `AUTH0_CLIENT_REDIRECT` | Browser Auth0 redirect URL for the deployed hostname |
| `AUTH0_DOMAIN` | Branded browser and token issuer domain, `auth.ferry.fyi` in production |
| `AW_TAG_ID` | Browser Ads conversion tag ID if enabled |
| `BASE_URL` | Production public URL, usually the Terraform `base_url` value |
| `DETECTOR_CONTEXT` | Optional detector Docker build context; defaults to `detector-runtime` when unset |
| `DETECTOR_DOCKERFILE` | Optional detector Dockerfile path; defaults to `detector-runtime/Dockerfile` when unset |
| `DETECTOR_ECR_REPOSITORY_URL` | `detector_ecr_repository_url` output |
| `ECR_REPOSITORY_URL` | `ecr_repository_url` output |
| `ECS_CLUSTER` | `ecs_cluster_name` output |
| `ECS_WEB_SERVICE` | `web_service_name` output |
| `ECS_DETECTOR_SERVICE` | `detector_service_name` output |
| `ECS_WEB_TASK_DEFINITION_FAMILY` | `web_task_definition_family` output |
| `ECS_DETECTOR_TASK_DEFINITION_FAMILY` | `detector_task_definition_family` output |
| `ECS_TASK_SUBNETS` | Comma-separated `ecs_task_subnet_ids` output |
| `ECS_TASK_SECURITY_GROUPS` | `ecs_task_security_group_id` output |
| `FIREBASE_API_KEY` | Browser Firebase API key from Firebase public app config |
| `FIREBASE_APP_ID` | Browser Firebase app ID from Firebase public app config |
| `FIREBASE_PROJECT_ID` | Browser Firebase project ID from Firebase public app config |
| `FIREBASE_SENDER_ID` | Browser Firebase sender ID from Firebase public app config |
| `FIREBASE_VAPID_KEY` | Browser Firebase VAPID public key from Firebase public app config |
| `GOOGLE_ANALYTICS` | Browser Google Analytics ID if enabled |
| `GTM_CONTAINER_ID` | Browser Google Tag Manager container ID if enabled |
| `LOG_LEVEL` | Browser log-level override if needed |
| `MAPBOX_ACCESS_TOKEN` | Browser Mapbox public token from Mapbox public token config |
| `SENTRY_DSN` | Browser Sentry DSN if enabled |

Keep application runtime secrets in AWS Secrets Manager.
Do not copy `DATABASE_URL`, Firebase service account JSON, Auth0 server secret, WSDOT API key, or `SENTRY_AUTH_TOKEN` into GitHub variables for ECS runtime deployment. If sourcemap upload is enabled later, store `SENTRY_AUTH_TOKEN` only as a GitHub build secret and do not pass it to ECS runtime.
Keep `AUTH0_SERVER_AUDIENCE` on the canonical tenant Management API URL even
when `AUTH0_DOMAIN` uses the branded custom domain.

## Auth0 email through Amazon SES

Terraform creates the `ferry.fyi` SES identity and separate development and
production IAM users with only `ses:SendEmail` and `ses:SendRawEmail` access from
`noreply@ferry.fyi`. It intentionally does not create an IAM access key because
Terraform would retain the secret in state.

After reviewing and applying the Terraform plan:

1. Read `ses_dkim_records` from `terraform output -json` and add each entry to
   Cloudflare as a DNS-only CNAME.
2. Wait for `aws sesv2 get-email-identity --region us-west-2 --email-identity ferry.fyi`
   to report `VERIFIED` DKIM and sending status.
3. Grant the Management API clients in both `ferryfyidev.us.auth0.com` and
   `ferryfyi.us.auth0.com` the `read:email_provider` and
   `update:email_provider` scopes.
4. Create separate access keys for the IAM users named by
   `auth0_ses_iam_user_name` and `auth0_ses_dev_iam_user_name`. Store each key
   only in its matching Auth0 tenant's SES provider configuration and the
   approved credential vault; never add either key to Terraform, Secrets
   Manager for the app, GitHub, or this repository.
5. Update each Auth0 tenant's email provider to `ses` with region `us-west-2`,
   From address `noreply@ferry.fyi`, and its tenant-specific access key, then
   send a test verification email from **Branding → Email Provider** in each
   tenant.
6. After the SES test succeeds, revoke the old SendGrid API key.

Auth0 requires AWS API credentials for its native SES integration. Do not enter
SES SMTP credentials in the AWS provider form; API credentials and SMTP
credentials are different credential types.

Keep `web_desired_count = 1` while the web process owns scheduled work. The shared database operation leases prevent deploy/startup overlap, but multiple long-lived web schedulers would maintain independent notification transition state.
