#!/usr/bin/env bash
set -euo pipefail

usage() {
  # usage text
  cat <<'USAGE'
Usage: put-app-config-secret.sh --secret-id ARN_OR_NAME --from-json infra/aws/local/app-config.secret.json

Merges an ignored Ferry FYI partial app-config JSON file into the existing AWS
Secrets Manager secret. Secret values are never printed. Set
CONFIRM_AWS_SECRET_UPDATE=yes to allow the write.
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

# restrict temporary secrets
umask 077
TMP_DIRECTORY="$(mktemp -d)"
TMP_CURRENT_SECRET="${TMP_DIRECTORY}/current.json"
TMP_MERGED_SECRET="${TMP_DIRECTORY}/merged.json"
cleanup() {
  # remove temporary secrets
  rm -rf -- "${TMP_DIRECTORY}"
}
trap cleanup EXIT

aws secretsmanager get-secret-value \
  --secret-id "${SECRET_ID}" \
  --query SecretString \
  --output text > "${TMP_CURRENT_SECRET}"

jq -s -e '
  # require two config objects
  if length != 2 or (.[0] | type) != "object" or (.[1] | type) != "object" then
    error("current secret and override must be JSON objects")
  # require one partial override
  elif (.[1] | length) == 0 then
    error("app config override must be a non-empty JSON object")
  # merge without dropping existing keys
  elif ((.[0] + .[1]) | length) > 0 then
    .[0] + .[1]
  else
    error("merged app config must be a non-empty JSON object")
  end
' "${TMP_CURRENT_SECRET}" "${FROM_JSON}" > "${TMP_MERGED_SECRET}"

aws secretsmanager put-secret-value \
  --secret-id "${SECRET_ID}" \
  --secret-string "file://${TMP_MERGED_SECRET}" \
  --output json \
  --query '{ARN:ARN,VersionId:VersionId,VersionStages:VersionStages}'

cat >&2 <<'EOF_DONE'
Updated app-config secret metadata above. Secret values were not printed.
Verify expected keys with aws secretsmanager get-secret-value piped through jq keys only.
EOF_DONE
