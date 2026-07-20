#!/usr/bin/env bash
set -euo pipefail

# Keep local Android builds monotonic with the Play release workflow. The
# year/day/time format stays below Play's maximum version-code value.
version_code="$(date -u +%y%j%H%M)"
version_code_number="$((10#${version_code}))"

if (( version_code_number <= 0 || version_code_number > 2100000000 )); then
  echo "Derived Android version code is outside Play's valid range: ${version_code}" >&2
  exit 1
fi

printf '%s\n' "${version_code}"
