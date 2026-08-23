#!/usr/bin/env bash
set -euo pipefail

usage() {
  # usage text
  cat <<'USAGE'
Usage: put-app-config-secret.sh --secret-id ARN_OR_NAME --from-json infra/aws/local/APP-heroku-config.raw.secret.json

Builds the Ferry FYI app-config JSON from an ignored local Heroku config export
and updates the existing AWS Secrets Manager secret. Secret values are never
printed. Set CONFIRM_AWS_SECRET_UPDATE=yes to allow the write.
USAGE
}

SECRET_ID=""
FROM_JSON=""

while [[ $# -gt 0 ]]; do
  # argument parser
  case "$1" in
    --secret-id)
      SECRET_ID="${2:-}"
      shift 2
      ;;
    --from-json)
      FROM_JSON="${2:-}"
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

if [[ -z "${SECRET_ID}" || -z "${FROM_JSON}" ]]; then
  # required inputs
  echo "Missing --secret-id or --from-json" >&2
  usage >&2
  exit 2
fi

if [[ "${CONFIRM_AWS_SECRET_UPDATE:-}" != "yes" ]]; then
  # explicit write gate
  echo "Refusing to update AWS Secrets Manager without CONFIRM_AWS_SECRET_UPDATE=yes" >&2
  exit 3
fi

if ! command -v aws >/dev/null 2>&1; then
  # aws cli requirement
  echo "AWS CLI is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  # jq requirement
  echo "jq is required" >&2
  exit 127
fi

if [[ ! -f "${FROM_JSON}" ]]; then
  # source guard
  echo "Input JSON does not exist: ${FROM_JSON}" >&2
  exit 2
fi

TMP_SECRET="$(mktemp)"
cleanup() {
  # remove temp secret
  rm -f "${TMP_SECRET}"
}
trap cleanup EXIT

jq '{
  ANDROID_CERT_FINGERPRINT: (.ANDROID_CERT_FINGERPRINT // ""),
  AUTH0_CLIENT_AUDIENCE: (.AUTH0_CLIENT_AUDIENCE // ""),
  AUTH0_CLIENT_ID: (.AUTH0_CLIENT_ID // ""),
  AUTH0_CLIENT_REDIRECT: (.AUTH0_CLIENT_REDIRECT // ""),
  AUTH0_DOMAIN: (.AUTH0_DOMAIN // ""),
  AUTH0_SERVER_AUDIENCE: (.AUTH0_SERVER_AUDIENCE // ""),
  AUTH0_SERVER_ID: (.AUTH0_SERVER_ID // ""),
  AUTH0_SERVER_SECRET: (.AUTH0_SERVER_SECRET // ""),
  AW_TAG_ID: (.AW_TAG_ID // ""),
  FCM_PUBLIC_KEY: (.FCM_PUBLIC_KEY // ""),
  FIREBASE_API_KEY: (.FIREBASE_API_KEY // ""),
  FIREBASE_APP_ID: (.FIREBASE_APP_ID // ""),
  FIREBASE_PROJECT_ID: (.FIREBASE_PROJECT_ID // ""),
  FIREBASE_SENDER_ID: (.FIREBASE_SENDER_ID // ""),
  FIREBASE_SERVICE_ACCOUNT: (.FIREBASE_SERVICE_ACCOUNT // ""),
  FIREBASE_VAPID_KEY: (.FIREBASE_VAPID_KEY // ""),
  GCM_SENDER_ID: (.GCM_SENDER_ID // ""),
  GOOGLE_ANALYTICS: (.GOOGLE_ANALYTICS // ""),
  GTM_CONTAINER_ID: (.GTM_CONTAINER_ID // ""),
  MAPBOX_ACCESS_TOKEN: (.MAPBOX_ACCESS_TOKEN // ""),
  REPORT_BASE_URL: (.REPORT_BASE_URL // ""),
  REVENUECAT_PROJECT_ID: (.REVENUECAT_PROJECT_ID // ""),
  REVENUECAT_PRODUCTION_WEBHOOK_AUTHORIZATION: (.REVENUECAT_PRODUCTION_WEBHOOK_AUTHORIZATION // ""),
  REVENUECAT_PRODUCTION_WEBHOOK_HMAC_SECRET: (.REVENUECAT_PRODUCTION_WEBHOOK_HMAC_SECRET // ""),
  REVENUECAT_SANDBOX_WEBHOOK_AUTHORIZATION: (.REVENUECAT_SANDBOX_WEBHOOK_AUTHORIZATION // ""),
  REVENUECAT_SANDBOX_WEBHOOK_HMAC_SECRET: (.REVENUECAT_SANDBOX_WEBHOOK_HMAC_SECRET // ""),
  REVENUECAT_V2_SECRET_API_KEY: (.REVENUECAT_V2_SECRET_API_KEY // ""),
  SENTRY_DSN: (.SENTRY_DSN // ""),
  SUPPORTER_ACTION_HMAC_SECRET: (.SUPPORTER_ACTION_HMAC_SECRET // ""),
  SUPPORTER_ANDROID_CHECKOUT_ENABLED: (.SUPPORTER_ANDROID_CHECKOUT_ENABLED // "false"),
  SUPPORTER_IOS_CHECKOUT_ENABLED: (.SUPPORTER_IOS_CHECKOUT_ENABLED // "false"),
  SUPPORTER_WEB_CHECKOUT_ENABLED: (.SUPPORTER_WEB_CHECKOUT_ENABLED // "false"),
  WSDOT_API_KEY: (.WSDOT_API_KEY // "")
}' "${FROM_JSON}" > "${TMP_SECRET}"
chmod 600 "${TMP_SECRET}"

aws secretsmanager put-secret-value \
  --secret-id "${SECRET_ID}" \
  --secret-string "file://${TMP_SECRET}" \
  --output json \
  --query '{ARN:ARN,VersionId:VersionId,VersionStages:VersionStages}'

cat >&2 <<'EOF_DONE'
Updated app-config secret metadata above. Secret values were not printed.
Verify expected keys with aws secretsmanager get-secret-value piped through jq keys only.
EOF_DONE
