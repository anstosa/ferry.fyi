#!/usr/bin/env bash
set -euo pipefail

IOS_REDIRECT_URI="fyi.ferry://callback"

# load shared local env
if [[ -f ./.envrc ]]; then
  # shellcheck disable=SC1091
  source ./.envrc
fi

# load ios overrides
if [[ -f ./ios/.envrc ]]; then
  # shellcheck disable=SC1091
  source ./ios/.envrc
fi

# default ios app host
if [[ -z "${BASE_URL:-}" || "${BASE_URL}" == http://localhost* ]]; then
  export BASE_URL="https://ferry.fyi"
fi

# prefer the ios-specific auth client
if [[ -n "${AUTH0_IOS_CLIENT_ID:-}" ]]; then
  export AUTH0_CLIENT_ID="${AUTH0_IOS_CLIENT_ID}"
fi

# prefer native callback override
if [[ -n "${IOS_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${IOS_AUTH0_CLIENT_REDIRECT}"
elif [[ -z "${AUTH0_CLIENT_REDIRECT:-}" || "${AUTH0_CLIENT_REDIRECT}" == http://localhost* ]]; then
  export AUTH0_CLIENT_REDIRECT="${IOS_REDIRECT_URI}"
fi

exec "$@"
