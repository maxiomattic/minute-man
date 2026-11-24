#!/usr/bin/env bash
# Build the Android app, install it on a device and launch it.
# Usage: scripts/android.sh [device-serial]     e.g. scripts/android.sh 100.121.188.48:37421
#   No serial: uses $ANDROID_SERIAL, else the only connected adb device.
#   BUILD_ONLY=1 scripts/android.sh   just builds the APK.
set -euo pipefail
cd "$(dirname "$0")/.."

# Enter the Nix toolchain (JDK 21 + Android SDK) from shell.nix if needed.
if [[ -z "${CVAS_AAPT2:-}" ]]; then
  export NIXPKGS_ALLOW_UNFREE=1 NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1
  exec nix-shell shell.nix --run "$(printf '%q ' "$0" "$@")"
fi

APK=android/app/build/outputs/apk/debug/app-debug.apk
[[ -d node_modules/@capacitor/android ]] || npm ci

echo "==> cap sync android"
npx cap sync android

echo "==> gradle assembleDebug"
(cd android && ./gradlew --console=plain assembleDebug \
  -Pandroid.aapt2FromMavenOverride="$CVAS_AAPT2")
echo "APK: $APK"
[[ -n "${BUILD_ONLY:-}" ]] && exit 0

serial=${1:-${ANDROID_SERIAL:-}}
if [[ -z "$serial" ]]; then
  mapfile -t devs < <(adb devices | awk 'NR>1 && $2=="device"{print $1}')
  if (( ${#devs[@]} != 1 )); then
    echo "Need exactly one adb device (found ${#devs[@]}). Pass a serial, or connect the phone:" >&2
    echo "  adb connect <pixel tailscale ip>:<wireless debugging port>" >&2
    exit 1
  fi
  serial=${devs[0]}
fi
[[ $serial == *:* ]] && adb connect "$serial" >/dev/null || true

echo "==> install on $serial"
adb -s "$serial" install -r "$APK"
adb -s "$serial" shell am start -n org.cvas.app/.MainActivity
