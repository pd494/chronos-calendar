#!/bin/sh
set -e

CONFIG="src-tauri/tauri.conf.dev.json"
APP_NAME=$(python3 -c "import json; print(json.load(open('$CONFIG'))['productName'])")
BUNDLE="src-tauri/target/debug/bundle/macos/${APP_NAME}.app"

if [ ! -d "$BUNDLE" ]; then
  echo "Bundle not found: $BUNDLE" >&2
  exit 1
fi

cp -rf "$BUNDLE" /Applications/
echo "Installed ${APP_NAME}.app to /Applications"
