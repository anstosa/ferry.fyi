#!/usr/bin/env bash
set -euo pipefail

usage() {
  # usage text
  cat <<'USAGE'
Usage: classify-heroku-config.sh --app HEROKU_APP [--out-dir infra/aws/local]

Exports Heroku config to an ignored local raw JSON file and writes a redacted
classification table containing key names only. The raw JSON contains secrets;
keep it local and delete it after the AWS import is complete.
USAGE
}

APP=""
OUT_DIR="infra/aws/local"

while [[ $# -gt 0 ]]; do
  # argument parser
  case "$1" in
    --app)
      APP="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${APP}" ]]; then
  # app requirement
  echo "Missing required --app HEROKU_APP" >&2
  usage >&2
  exit 2
fi

if ! command -v heroku >/dev/null 2>&1; then
  # heroku cli requirement
  echo "Heroku CLI is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  # jq requirement
  echo "jq is required" >&2
  exit 127
fi

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}"

RAW_JSON="${OUT_DIR}/${APP}-heroku-config.raw.secret.json"
CLASSIFIED_TSV="${OUT_DIR}/${APP}-heroku-config.classified.tsv"

cat >&2 <<EOF_WARN
WARNING: exporting Heroku config for ${APP}.
- Raw secret values will be written to ${RAW_JSON}.
- The classified TSV contains key names only and redacted categories.
- ${OUT_DIR}/ is ignored by git; verify before moving files.
EOF_WARN

heroku config --json --app "${APP}" > "${RAW_JSON}"
chmod 600 "${RAW_JSON}"

jq -r '
  def classify($key):
    # platform config keys
    if ($key | test("^(BASE_URL|PORT|NODE_ENV|PROCESS_ROLE|RUN_SCHEDULER)$")) then "AWS/ECS platform config"
    # browser-visible build keys
    elif ($key | test("^(VITE_|PUBLIC_|GOOGLE_ANALYTICS|GTM_CONTAINER_ID|MAPBOX_ACCESS_TOKEN)$")) then "build-time public"
    # build-only secret keys
    elif ($key | test("^SENTRY_AUTH_TOKEN$")) then "build-time secret"
    # heroku-only migration keys
    elif ($key | test("^(DATABASE_URL|HEROKU_|PG|PG[A-Z_]*|REDIS_URL)$")) then "migration-only"
    # runtime secret keys
    elif ($key | test("(SECRET|PASSWORD|PRIVATE|TOKEN|KEY|AUTH0|FIREBASE|FCM|GCM|SENTRY|WSDOT|CERT|DSN|AUDIENCE|CLIENT_ID|PROJECT_ID|APP_ID|SENDER_ID|TAG_ID)")) then "runtime server secret/config"
    # unknown keys
    else "review manually"
    end;
  def secret_like($key):
    ($key | test("(SECRET|PASSWORD|PRIVATE|TOKEN|KEY|DATABASE_URL|REDIS_URL|AUTH0|FIREBASE|FCM|GCM|SENTRY|WSDOT|CERT|DSN)"));
  ["key", "category", "secret_like", "destination", "notes"],
  (keys_unsorted[] as $key |
    [
      $key,
      classify($key),
      (secret_like($key) | tostring),
      (# destination mapping
       if classify($key) == "build-time public" then "GitHub variable or Docker build arg"
       elif classify($key) == "build-time secret" then "GitHub secret or build-only secret"
       elif classify($key) == "AWS/ECS platform config" then "Terraform env or SSM parameter"
       elif classify($key) == "migration-only" then "do not import unless still required"
       else "AWS Secrets Manager app config JSON" end),
      "value redacted"
    ]
  ) | @tsv
' "${RAW_JSON}" > "${CLASSIFIED_TSV}"

cat >&2 <<EOF_DONE
Wrote ${CLASSIFIED_TSV} with redacted key classifications.
Review every "review manually" and "migration-only" row before importing.
EOF_DONE
