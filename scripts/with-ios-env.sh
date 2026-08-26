#!/usr/bin/env bash
set -euo pipefail

IOS_AUTH0_DOMAIN_PRODUCTION="auth.ferry.fyi"
IOS_AUTH0_AUDIENCE_PRODUCTION="https://ferry.fyi/api"
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

# prefer the ios-specific api audience
if [[ -n "${IOS_AUTH0_CLIENT_AUDIENCE:-}" ]]; then
  export AUTH0_CLIENT_AUDIENCE="${IOS_AUTH0_CLIENT_AUDIENCE}"
fi

# prefer the ios-specific auth domain
if [[ -n "${IOS_AUTH0_DOMAIN:-}" ]]; then
  export AUTH0_DOMAIN="${IOS_AUTH0_DOMAIN}"
fi

# prefer native callback override
if [[ -n "${IOS_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${IOS_AUTH0_CLIENT_REDIRECT}"
elif [[ -z "${AUTH0_CLIENT_REDIRECT:-}" || "${AUTH0_CLIENT_REDIRECT}" == http://localhost* ]]; then
  export AUTH0_CLIENT_REDIRECT="${IOS_REDIRECT_URI}"
fi

# release guard
if [[ "${IOS_ENFORCE_PROD_AUTH0:-}" == "1" ]]; then
  for required_var in AUTH0_DOMAIN AUTH0_CLIENT_ID AUTH0_CLIENT_AUDIENCE AUTH0_CLIENT_REDIRECT; do
    # required setting guard
    if [[ -z "${!required_var:-}" ]]; then
      echo "Missing required iOS Auth0 variable: ${required_var}" >&2
      exit 1
    fi
  done

  # authentication domain guard
  if [[ "${AUTH0_DOMAIN}" != "${IOS_AUTH0_DOMAIN_PRODUCTION}" ]]; then
    echo "iOS release Auth0 domain must be ${IOS_AUTH0_DOMAIN_PRODUCTION}, got ${AUTH0_DOMAIN}" >&2
    exit 1
  fi

  # api audience guard
  if [[ "${AUTH0_CLIENT_AUDIENCE}" != "${IOS_AUTH0_AUDIENCE_PRODUCTION}" ]]; then
    echo "iOS release Auth0 audience must be ${IOS_AUTH0_AUDIENCE_PRODUCTION}, got ${AUTH0_CLIENT_AUDIENCE}" >&2
    exit 1
  fi

  # callback guard
  if [[ "${AUTH0_CLIENT_REDIRECT}" != "${IOS_REDIRECT_URI}" ]]; then
    echo "iOS release Auth0 redirect must be ${IOS_REDIRECT_URI}, got ${AUTH0_CLIENT_REDIRECT}" >&2
    exit 1
  fi
fi

exec "$@"
