#!/usr/bin/env bash
set -euo pipefail

sdk_root="$1"
serial="$2"
adb="$sdk_root/platform-tools/adb.exe"

(
  cd android
  ./gradlew assembleDebug
)

apk="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$apk" ]]; then
  echo "Android debug APK was not produced at '$apk'." >&2
  exit 1
fi

"$adb" -s "$serial" install -r "$(wslpath -w "$apk")"
"$adb" -s "$serial" shell am start -n fyi.ferry/.MainActivity
