#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$project_dir/android"
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --console=plain
printf '%s\n' "APK: $project_dir/android/app/build/outputs/apk/debug/app-debug.apk" "Test APK: $project_dir/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
