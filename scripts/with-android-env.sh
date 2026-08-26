#!/usr/bin/env bash
set -euo pipefail

ANDROID_AUTH0_DOMAIN_PRODUCTION="auth.ferry.fyi"
ANDROID_AUTH0_AUDIENCE_PRODUCTION="https://ferry.fyi/api"
ANDROID_REDIRECT_URI="fyi.ferry://${ANDROID_AUTH0_DOMAIN_PRODUCTION}/capacitor/fyi.ferry/callback"
HAS_ANDROID_ENV=0

# load shared local env
if [[ -f ./.envrc ]]; then
  # shellcheck disable=SC1091
  source ./.envrc
fi

# load android overrides
if [[ -f ./android/.envrc ]]; then
  # shellcheck disable=SC1091
  source ./android/.envrc
  HAS_ANDROID_ENV=1
fi


# load sdk path from gradle
if [[ -z "${ANDROID_SDK_ROOT:-}" && -f ./android/local.properties ]]; then
  ANDROID_SDK_ROOT="$(sed -n 's/^sdk.dir=//p' ./android/local.properties | head -n 1)"
  export ANDROID_SDK_ROOT
fi

# expose sdk tools
if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
  export PATH="${ANDROID_SDK_ROOT}/platform-tools:${ANDROID_SDK_ROOT}/emulator:${PATH}"
fi

# default android app host
if [[ -z "${BASE_URL:-}" || "${BASE_URL}" == http://localhost* ]]; then
  export BASE_URL="https://ferry.fyi"
fi

# prefer android auth overrides
if [[ -n "${ANDROID_AUTH0_DOMAIN:-}" ]]; then
  export AUTH0_DOMAIN="${ANDROID_AUTH0_DOMAIN}"
fi

if [[ -n "${ANDROID_AUTH0_CLIENT_ID:-}" ]]; then
  export AUTH0_CLIENT_ID="${ANDROID_AUTH0_CLIENT_ID}"
fi

if [[ -n "${ANDROID_AUTH0_CLIENT_AUDIENCE:-}" ]]; then
  export AUTH0_CLIENT_AUDIENCE="${ANDROID_AUTH0_CLIENT_AUDIENCE}"
fi

# prefer native callback override
if [[ -n "${ANDROID_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${ANDROID_AUTH0_CLIENT_REDIRECT}"
fi

# force native callback without android env
if [[ "${HAS_ANDROID_ENV}" == "0" && -z "${ANDROID_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${ANDROID_REDIRECT_URI}"
fi

# Release guard: internal testing must use production Auth0, not dev/staging.
if [[ "${ANDROID_ENFORCE_PROD_AUTH0:-}" == "1" ]]; then
  for required_var in AUTH0_DOMAIN AUTH0_CLIENT_ID AUTH0_CLIENT_AUDIENCE AUTH0_CLIENT_REDIRECT; do
    if [[ -z "${!required_var:-}" ]]; then
      echo "Missing required Android Auth0 variable: ${required_var}" >&2
      exit 1
    fi
  done

  if [[ "${AUTH0_DOMAIN}" != "${ANDROID_AUTH0_DOMAIN_PRODUCTION}" ]]; then
    echo "Android release Auth0 domain must be ${ANDROID_AUTH0_DOMAIN_PRODUCTION}, got ${AUTH0_DOMAIN}" >&2
    exit 1
  fi

  if [[ "${AUTH0_CLIENT_AUDIENCE}" != "${ANDROID_AUTH0_AUDIENCE_PRODUCTION}" ]]; then
    echo "Android release Auth0 audience must be ${ANDROID_AUTH0_AUDIENCE_PRODUCTION}, got ${AUTH0_CLIENT_AUDIENCE}" >&2
    exit 1
  fi

  if [[ "${AUTH0_CLIENT_REDIRECT}" != "${ANDROID_REDIRECT_URI}" ]]; then
    echo "Android release Auth0 redirect must be ${ANDROID_REDIRECT_URI}, got ${AUTH0_CLIENT_REDIRECT}" >&2
    exit 1
  fi
fi

exec "$@"
