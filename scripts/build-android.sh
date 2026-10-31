#!/usr/bin/env bash
set -euo pipefail
base=$(cd "$(dirname "$0")/.." && pwd)
: "${WORKBENCH_KEYSTORE:?Set the release keystore path outside the repository}"
: "${WORKBENCH_STORE_PASSWORD:?Set the keystore password in the environment}"
: "${WORKBENCH_KEY_PASSWORD:?Set the signing key password in the environment}"
cd "$base/android"
./gradlew :app:assembleRelease :app:lintRelease --console=plain
echo 'APK: android/app/build/outputs/apk/release/app-release.apk'
