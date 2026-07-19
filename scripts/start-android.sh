#!/usr/bin/env bash
set -euo pipefail

IFS='|' read -r platform serial sdk_root < <(scripts/start-android-emulator.sh)

NODE_ENV=production CACHE_NAME=android vite build --config client/vite.config.ts
cap sync android

if [[ "$platform" == "windows" ]]; then
  scripts/install-windows-android-app.sh "$sdk_root" "$serial"
else
  cap run android --no-sync --target "$serial"
fi

NODE_ENV=production CACHE_NAME=android vite build --config client/vite.config.ts --watch
