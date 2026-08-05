# Ferry FYI Heroku to AWS/RDS migration runbook

This runbook stages the production AWS stack behind `staging.ferry.fyi`, restores Heroku Postgres into the target RDS database, validates ECS through the production ALB, and leaves final `ferry.fyi` / `www.ferry.fyi` DNS cutover manual in Cloudflare.

Do not paste secret values into this file, GitHub logs, shell history, Terraform variables, or tracked artifacts. Use ignored local files under `infra/aws/local/` for temporary exports and delete them after cutover.

## Known sizing baseline

| Source | Engine | Plan / class | Storage evidence | Connections |
| --- | --- | --- | --- | --- |
| Heroku Postgres | PostgreSQL 17.9 | `essential-1` | 963 MB used / 10 GB limit | 4 / 20 |
| Target RDS default | PostgreSQL 17.9 | `db.t4g.small` | 20 GiB gp3, autoscale max 100 GiB | instance default |

The target RDS storage headroom is roughly 21x the current 963 MB data size before autoscaling and roughly 103x at the 100 GiB autoscaling ceiling. Re-check both sides before the restore because these figures are point-in-time G003 evidence.

## Preflight checklist

- Confirm the local checkout has no filled `.envrc`, dump files, Heroku config values, private keys, Firebase service account JSON, database URLs, WSDOT keys, or Auth0 secrets staged for commit.
- Confirm Terraform output exists for `alb_dns_name`, `alb_zone_id`, `acm_validation_records`, `database_url_secret_arn`, `app_config_secret_arn`, `github_deploy_role_arn`, `ecs_task_subnet_ids`, and `ecs_task_security_group_id`.
- Confirm Cloudflare has the ACM validation records from Terraform and that ACM is issued before enabling HTTPS.
- Confirm `staging.ferry.fyi` points to the production ALB before validating ECS.
- Confirm RDS deletion protection is enabled before final production DNS cutover, not merely before staging validation.
- Confirm Heroku scheduler-like jobs remain single-owner during the migration window; the singleton AWS web service runs both HTTP traffic and recurring jobs with `RUN_SCHEDULER=true`.
- Confirm the production deploy workflow is configured with GitHub repository or organization-level variables from Terraform outputs and that application runtime secrets are in AWS Secrets Manager, not GitHub secrets. The current branch-scoped OIDC trust does not use a GitHub Environment, so do not add `environment: production` unless Terraform trust is changed to the environment-scoped subject and GitHub Environment branch restrictions are enforced.

## Local secret-handling workspace

Create an ignored local workspace for temporary exports:

```sh
mkdir -p infra/aws/local
chmod 700 infra/aws/local
```

`infra/aws/local/` is ignored by git. Keep raw Heroku config exports, temporary secret JSON, presigned backup URLs, and local restore logs there only.

## Export and classify Heroku config

The helper writes raw secret values only to ignored local files and writes a redacted classification table with key names only:

```sh
infra/aws/scripts/classify-heroku-config.sh --app ferry-fyi --out-dir infra/aws/local
column -t -s $'\t' infra/aws/local/ferry-fyi-heroku-config.classified.tsv | less -S
```

Manual fallback without the helper:

```sh
heroku config --json --app ferry-fyi > infra/aws/local/ferry-fyi-heroku-config.raw.secret.json
chmod 600 infra/aws/local/ferry-fyi-heroku-config.raw.secret.json
jq -r 'keys_unsorted[]' infra/aws/local/ferry-fyi-heroku-config.raw.secret.json > infra/aws/local/ferry-fyi-heroku-config.keys.txt
```

Classify every key into one of these categories before import:

| Category | Examples | AWS destination |
| --- | --- | --- |
| Build-time public | `BASE_URL`, Auth0 browser client settings, Firebase browser IDs, analytics/container IDs, Mapbox public token, Sentry DSN | GitHub repository/org-level variable or Docker build arg; values come from Heroku config classification/public provider config and are never committed |
| Build-time secret | `SENTRY_AUTH_TOKEN` for sourcemap upload if used | GitHub secret or a separate build-only secret; do not expose to ECS runtime unless needed |
| Runtime server secret/config | Auth0 server config, Firebase service account, advertiser report origin, Sentry DSN if the server uses it, WSDOT API key | AWS Secrets Manager `app_config_secret_arn` JSON; excludes `SENTRY_AUTH_TOKEN` |
| AWS/ECS platform config | `BASE_URL`, `PORT`, `NODE_ENV`, `PROCESS_ROLE`, `RUN_SCHEDULER` | Terraform task environment / SSM parameters / GitHub deployment variables |
| Migration-only | Heroku `DATABASE_URL`, Heroku-specific Postgres vars, one-time backup URLs | Do not import except as temporary local restore inputs |

Tracked templates may contain key names and categories only. Never track values.

Required browser build-time GitHub repository/org-level variables for `.github/workflows/deploy-aws.yml` are `AUTH0_CLIENT_AUDIENCE`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_REDIRECT`, `AUTH0_DOMAIN`, `AW_TAG_ID`, `BASE_URL`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_VAPID_KEY`, `GOOGLE_ANALYTICS`, `GTM_CONTAINER_ID`, `LOG_LEVEL`, `MAPBOX_ACCESS_TOKEN`, and `SENTRY_DSN`. `HEROKU_RELEASE_VERSION` is supplied by the workflow from the Git SHA. If sourcemap upload is added later, keep `SENTRY_AUTH_TOKEN` as a GitHub build secret only and do not import it into ECS runtime app config.

## Prepare AWS Secrets Manager app config

Get the app config secret ARN without printing secret values:

```sh
cd infra/aws/terraform
APP_CONFIG_SECRET_ARN="$(terraform output -raw app_config_secret_arn)"
DATABASE_URL_SECRET_ARN="$(terraform output -raw database_url_secret_arn)"
cd ../../..
printf 'app config secret: %s\n' "${APP_CONFIG_SECRET_ARN}"
printf 'database url secret: %s\n' "${DATABASE_URL_SECRET_ARN}"
```

Dry-review the app-config keys that will be present after import. Missing optional
Heroku keys are imported as empty strings so ECS JSON-key secret references still
resolve at task start:

```sh
jq '{
  ANDROID_CERT_FINGERPRINT,
  AUTH0_CLIENT_AUDIENCE,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_REDIRECT,
  AUTH0_DOMAIN,
  AUTH0_SERVER_AUDIENCE,
  AUTH0_SERVER_ID,
  AUTH0_SERVER_SECRET,
  AW_TAG_ID,
  FIREBASE_API_KEY,
  FIREBASE_APP_ID,
  FIREBASE_PROJECT_ID,
  FIREBASE_SENDER_ID,
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_VAPID_KEY,
  GOOGLE_ANALYTICS,
  GTM_CONTAINER_ID,
  MAPBOX_ACCESS_TOKEN,
  REPORT_BASE_URL,
  SENTRY_DSN,
  WSDOT_API_KEY
} | keys' \
  infra/aws/local/ferry-fyi-heroku-config.raw.secret.json
```

Import app config only after review. The helper requires an explicit environment gate and prints only AWS metadata:

```sh
CONFIRM_AWS_SECRET_UPDATE=yes \
  infra/aws/scripts/put-app-config-secret.sh \
  --secret-id "${APP_CONFIG_SECRET_ARN}" \
  --from-json infra/aws/local/ferry-fyi-heroku-config.raw.secret.json
```

Verify key presence without exposing values:

```sh
aws secretsmanager get-secret-value \
  --secret-id "${APP_CONFIG_SECRET_ARN}" \
  --query SecretString \
  --output text | jq 'fromjson | keys'
```

The RDS `DATABASE_URL` is generated by Terraform in `database_url_secret_arn`. Do not copy the Heroku `DATABASE_URL` into AWS runtime secrets. If the RDS secret must be inspected for a restore, write it to an ignored local file and avoid shell history expansion:

```sh
aws secretsmanager get-secret-value \
  --secret-id "${DATABASE_URL_SECRET_ARN}" \
  --query SecretString \
  --output text > infra/aws/local/rds-database-url.secret.txt
chmod 600 infra/aws/local/rds-database-url.secret.txt
```

## Re-check Heroku and RDS database size

Heroku metadata, without printing URLs or credentials:

```sh
heroku pg:info --app ferry-fyi
heroku pg:ps --app ferry-fyi
```

RDS metadata from Terraform output and AWS CLI:

```sh
cd infra/aws/terraform
RDS_ENDPOINT="$(terraform output -raw database_endpoint)"
cd ../../..
aws rds describe-db-instances \
  --db-instance-identifier ferry-fyi-prod \
  --query 'DBInstances[0].{Engine:Engine,EngineVersion:EngineVersion,Class:DBInstanceClass,AllocatedGiB:AllocatedStorage,MaxAllocatedGiB:MaxAllocatedStorage,MultiAZ:MultiAZ,DeletionProtection:DeletionProtection,BackupRetention:BackupRetentionPeriod,Endpoint:Endpoint.Address}'
printf 'Terraform endpoint: %s\n' "${RDS_ENDPOINT}"
```

Optional in-database size check after credentials are available locally:

```sh
DATABASE_URL="$(cat infra/aws/local/rds-database-url.secret.txt)" \
  psql "${DATABASE_URL}" \
  -c "select pg_size_pretty(pg_database_size(current_database())) as database_size;"
```

## Capture Heroku backup

Capture a fresh Heroku backup and store only the backup id / metadata in notes:

```sh
heroku pg:backups:capture --app ferry-fyi
heroku pg:backups --app ferry-fyi
```

Download to an ignored local dump if restoring from an operator machine:

```sh
heroku pg:backups:download --app ferry-fyi --output infra/aws/local/ferry-fyi-heroku.dump
chmod 600 infra/aws/local/ferry-fyi-heroku.dump
```

If using a presigned Heroku backup URL for ECS restore, keep the URL in an ignored local file and never paste it into tracked docs or issue comments:

```sh
heroku pg:backups:url --app ferry-fyi > infra/aws/local/heroku-backup-url.secret.txt
chmod 600 infra/aws/local/heroku-backup-url.secret.txt
```

## Restore path A: one-off ECS task inside AWS

Use this when the application image has `pg_restore`, `psql`, and `curl` available. If the image lacks those tools, use Restore path B.

1. Temporarily scale ECS services down or ensure they cannot write to RDS during restore:

   ```sh
   aws ecs update-service --cluster ferry-fyi-prod --service ferry-fyi-prod-web --desired-count 0
   ```

2. Register or render a one-off task definition that uses the web task execution role, ECS task role, `DATABASE_URL` secret reference, public subnets, and ECS security group from Terraform outputs.

3. Run a restore command that fetches the Heroku backup URL from a temporary secret or an operator-provided environment override, then restores into RDS. Do not put the backup URL or `DATABASE_URL` directly in shell history.

   Example command shape for the container override:

   ```sh
   sh -lc 'set -euo pipefail; curl --fail --location --silent --show-error "${HEROKU_BACKUP_URL}" --output /tmp/heroku.dump; pg_restore --clean --if-exists --no-owner --no-acl --dbname "${DATABASE_URL}" /tmp/heroku.dump'
   ```

4. Wait for task completion and inspect only exit codes and non-secret logs:

   ```sh
   aws ecs describe-tasks --cluster ferry-fyi-prod --tasks TASK_ARN \
     --query 'tasks[0].containers[].{name:name,lastStatus:lastStatus,exitCode:exitCode,reason:reason}'
   aws logs tail /ecs/ferry-fyi-prod/web --since 30m --filter-pattern 'restore OR error OR failed'
   ```

## Restore path B: operator machine fallback

Use this when ECS lacks restore tooling or temporary URL handling would expose too much risk. The operator machine must have network access to RDS, `pg_restore`, `psql`, AWS CLI, and the ignored Heroku dump.

```sh
DATABASE_URL="$(cat infra/aws/local/rds-database-url.secret.txt)"
pg_restore --clean --if-exists --no-owner --no-acl --dbname "${DATABASE_URL}" infra/aws/local/ferry-fyi-heroku.dump
```

If the RDS instance is private and the operator machine cannot reach it directly, use an ECS one-off task or a short-lived bastion/SSM path approved outside this repo. Do not make RDS public for convenience.

## Migrations and table/count validation

Run migrations against RDS after restore using the same ECS one-off mechanism used by deployment:

```sh
aws ecs run-task \
  --cluster ferry-fyi-prod \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[SUBNET_1,SUBNET_2],securityGroups=[SECURITY_GROUP],assignPublicIp=ENABLED}" \
  --task-definition ferry-fyi-prod-web \
  --overrides '{"containerOverrides":[{"name":"web","command":["yarn","db:migrate"]}]}'
```

Validate expected tables and row counts without dumping data:

```sh
DATABASE_URL="$(cat infra/aws/local/rds-database-url.secret.txt)" psql "${DATABASE_URL}" <<'SQL'
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select schemaname, relname as table_name, n_live_tup as estimated_rows
from pg_stat_user_tables
order by relname;
SQL
```

Compare the table list and approximate counts against Heroku. For Heroku, run the same queries through `heroku pg:psql --app ferry-fyi` but do not export row data into tracked files.

## Staging validation through production ALB

Cloudflare should point `staging.ferry.fyi` to Terraform `alb_dns_name`. Validate HTTPS only after ACM is issued and `enable_https_listener=true` has been applied.

HTTP/API smoke checks:

```sh
curl -fsS https://staging.ferry.fyi/healthz
curl -fsS https://staging.ferry.fyi/api/terminals | jq 'keys | length'
curl -fsS 'https://staging.ferry.fyi/api/schedule/1/3' | jq 'keys'
```

Browser smoke checks:

- Open `https://staging.ferry.fyi/` in a clean browser profile.
- Confirm static assets load from `staging.ferry.fyi` and no browser calls go to Heroku domains.
- Open a route schedule page and confirm network calls are same-origin `/api/...` against the AWS ALB-backed host.
- Confirm login redirects are expected for the staging domain before testing authenticated flows.
- Confirm camera, terminal, and schedule pages render without console errors.

ECS and scheduler checks:

```sh
aws ecs describe-services --cluster ferry-fyi-prod --services ferry-fyi-prod-web \
  --query 'services[].{service:serviceName,desired:desiredCount,running:runningCount,pending:pendingCount,taskDefinition:taskDefinition}'
aws logs tail /ecs/ferry-fyi-prod/web --since 30m --filter-pattern 'ERROR OR Error OR error OR failed OR scheduler'
```

Expected scheduler ownership:

- The singleton web task should identify `PROCESS_ROLE=web` / `RUN_SCHEDULER=true` behavior and should be the only recurring job owner.

## Enable deletion protection before cutover

Before pointing production DNS at AWS, set deletion protection and apply the Terraform change:

```hcl
rds_deletion_protection = true
```

Then:

```sh
cd infra/aws/terraform
terraform plan -out tfplan
terraform apply tfplan
terraform output -raw alb_dns_name
```

Verify AWS reports deletion protection enabled:

```sh
aws rds describe-db-instances \
  --db-instance-identifier ferry-fyi-prod \
  --query 'DBInstances[0].DeletionProtection'
```

## Final DNS cutover

Cloudflare remains manual.

1. Lower DNS TTL before the migration window if current records use long TTLs.
2. Add `ferry.fyi` and `www.ferry.fyi` to Terraform `app_domains` and set `base_url = "https://ferry.fyi"`.
3. Apply Terraform, create any new ACM validation CNAMEs in Cloudflare, wait for ACM issued, and keep `enable_https_listener=true`.
4. Rebuild/deploy the production branch with `BASE_URL=https://ferry.fyi`.
5. Pause Heroku writes/scheduler if still running.
6. Capture final Heroku backup, restore to RDS, run migrations, and validate counts.
7. In Cloudflare, point `ferry.fyi` and `www.ferry.fyi` to the same ALB target already proven by `staging.ferry.fyi`.
8. Re-run `/healthz`, terminal API, schedule API, browser same-origin checks, and the web task's scheduler singleton log checks.
9. Keep Heroku app and database intact until the rollback window has passed.

## Cloudflare Tunnel ALB cost reduction

After `ferry.fyi` is stable on AWS, Cloudflare Tunnel can replace the public ALB ingress path.
Use a remotely-managed tunnel so the ECS web task only needs the tunnel token, and Cloudflare owns the public hostname routing.

1. In Cloudflare, create a tunnel for Ferry FYI and set the public hostname `ferry.fyi` to `http://localhost:4040`.
2. Copy the tunnel token and store it in AWS Secrets Manager:

   ```sh
   aws secretsmanager put-secret-value \
     --region us-west-2 \
     --secret-id /ferry-fyi/prod/CLOUDFLARE_TUNNEL_TOKEN \
     --secret-string '<TUNNEL_TOKEN>'
   ```

3. Set `enable_cloudflare_tunnel = true` and keep `enable_public_alb = true`.
4. Apply Terraform, deploy the web service, and confirm Cloudflare shows the tunnel connector as healthy.
5. Verify `https://ferry.fyi/healthz`, route pages, and schedule APIs through Cloudflare.
6. Set `enable_public_alb = false` and apply Terraform to remove the ALB, ALB listeners, target group attachment, and ALB public IPv4 charges.

Keep the ALB on until the tunnel is healthy. Roll back by setting `enable_public_alb = true` and pointing Cloudflare DNS back to the ALB target.

## Rollback

Rollback is DNS-first while Heroku remains intact:

1. Repoint Cloudflare `ferry.fyi` and `www.ferry.fyi` to the previous Heroku targets.
2. Confirm Heroku web dynos and scheduler/jobs are running as the sole production writers.
3. Scale down the combined AWS web/scheduler service to avoid double writes:

   ```sh
   aws ecs update-service --cluster ferry-fyi-prod --service ferry-fyi-prod-web --desired-count 0
   ```

4. Preserve RDS for forensic comparison. Do not destroy the AWS stack during rollback.
5. Document the failed validation evidence and retry from staging after fixing the issue.

## Cleanup after successful cutover

- Delete `infra/aws/local/*.secret.*`, `infra/aws/local/*.dump`, presigned URLs, and local restore logs.
- Rotate any secrets that were exposed outside approved secret stores during manual handling.
- Keep Terraform state protected because it contains the generated RDS password / `DATABASE_URL` secret version.
- Decommission Heroku only after the agreed rollback window and a final backup retention decision.
