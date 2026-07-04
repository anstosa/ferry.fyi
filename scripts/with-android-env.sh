#!/usr/bin/env bash
set -euo pipefail

ANDROID_REDIRECT_URI="fyi.ferry://ferryfyi.us.auth0.com/capacitor/fyi.ferry/callback"
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

# prefer native callback override
if [[ -n "${ANDROID_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${ANDROID_AUTH0_CLIENT_REDIRECT}"
fi

# force native callback without android env
if [[ "${HAS_ANDROID_ENV}" == "0" && -z "${ANDROID_AUTH0_CLIENT_REDIRECT:-}" ]]; then
  export AUTH0_CLIENT_REDIRECT="${ANDROID_REDIRECT_URI}"
fi

exec "$@"
