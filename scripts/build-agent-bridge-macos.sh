#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
destination="$root/output/agent-bridge"
if test "$#" -gt 0; then destination="$1"; fi
app="$destination/Workbench Agent Bridge.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$destination/.swift-module-cache"
xcrun swiftc -module-cache-path "$destination/.swift-module-cache" -swift-version 5 -O -framework AppKit -framework Security \
  "$root/macos/AgentBridge.swift" -o "$app/Contents/MacOS/WorkbenchAgentBridge"
python3 - "$root/connector" "$app/Contents/Resources/connector" <<'PY'
from pathlib import Path
import shutil, sys
src, dst = map(Path, sys.argv[1:])
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns('test', 'tests', '*.test.mjs', 'node_modules', '*.json', '*.log'))
PY
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.workbench.agentbridge</string>
<key>CFBundleName</key><string>Workbench Agent Bridge</string>
<key>CFBundleDisplayName</key><string>工作台 Agent 连接</string>
<key>CFBundleExecutable</key><string>WorkbenchAgentBridge</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Agent device pairing</string>
<key>CFBundleURLSchemes</key><array><string>workbench-agent</string></array>
</dict></array>
</dict></plist>
PLIST
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
archive="$destination/Workbench-Agent-Bridge-macos-$(uname -m).zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
shasum -a 256 "$archive" > "$archive.sha256"
printf '%s\n' "$app" "$archive"
