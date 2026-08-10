#!/usr/bin/env bash
set -euo pipefail

# load local development credentials
if [[ -f ./.envrc ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.envrc
  set +a
fi

exec docker compose -f docker-compose.dev.yml "$@"
