#!/usr/bin/env bash
set -euo pipefail

platform="linux"
sdk_root="${ANDROID_SDK_ROOT:-}"
adb="$(command -v adb || true)"
emulator="$(command -v emulator || true)"

if [[ -n "${WSL_INTEROP:-}" ]]; then
  for candidate in /mnt/c/Users/*/AppData/Local/Android/Sdk; do
    if [[ -x "$candidate/platform-tools/adb.exe" && -x "$candidate/emulator/emulator.exe" ]]; then
      platform="windows"
      sdk_root="$candidate"
      adb="$candidate/platform-tools/adb.exe"
      emulator="$candidate/emulator/emulator.exe"
      break
    fi
  done
fi

emulator_serial() {
  "$adb" devices | tr -d '\r' | awk '$1 ~ /^emulator-[0-9]+$/ && $2 == "device" { print $1; exit }'
}

emulator_boot_completed() {
  local serial="$1"
  [[ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]
}

serial="$(emulator_serial)"
if [[ -n "$serial" ]] && emulator_boot_completed "$serial"; then
  printf '%s|%s|%s\n' "$platform" "$serial" "$sdk_root"
  exit 0
fi

if [[ -n "$serial" ]]; then
  echo "Waiting for Android emulator '$serial' to finish booting..." >&2
else
  if [[ -n "${ANDROID_AVD_NAME:-}" ]]; then
    avd="${ANDROID_AVD_NAME}"
    if ! "$emulator" -list-avds | tr -d '\r' | grep -Fxq "$avd"; then
      echo "Android virtual device '$avd' was not found." >&2
      exit 1
    fi
  else
    avd="$("$emulator" -list-avds | tr -d '\r' | sed '/^$/d' | head -n 1)"
    if [[ -z "$avd" ]]; then
      echo 'No Android virtual devices are configured. Create one with Android Studio Device Manager.' >&2
      exit 1
    fi
  fi

  if [[ "$platform" == "windows" ]]; then
    emulator_windows_path="$(wslpath -w "$emulator")"
    echo "Starting Windows Android emulator '$avd' before building the app..." >&2
    powershell.exe -NoProfile -Command "Start-Process -FilePath '$emulator_windows_path' -ArgumentList '-avd', '$avd', '-no-snapshot'"
  else
    log_file="${TMPDIR:-/tmp}/ferry-fyi-android-emulator.log"
    echo "Starting Linux Android emulator '$avd' with a cold boot and software rendering..." >&2
    setsid "$emulator" -avd "$avd" -no-snapshot -gpu swiftshader_indirect >"$log_file" 2>&1 < /dev/null &
    emulator_pid="$!"
  fi
fi

timeout_seconds="${ANDROID_EMULATOR_START_TIMEOUT:-360}"
for ((second = 0; second < timeout_seconds; second++)); do
  serial="$(emulator_serial)"
  if [[ -n "$serial" ]] && emulator_boot_completed "$serial"; then
    printf '%s|%s|%s\n' "$platform" "$serial" "$sdk_root"
    exit 0
  fi
  if [[ -n "${emulator_pid:-}" ]] && ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "Android emulator '$avd' exited before booting. See ${TMPDIR:-/tmp}/ferry-fyi-android-emulator.log." >&2
    exit 1
  fi
  sleep 1
done

echo "Android emulator did not finish booting within ${timeout_seconds}s." >&2
exit 1
