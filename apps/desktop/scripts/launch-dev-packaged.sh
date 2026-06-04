#!/bin/bash
# Launch the packaged dev version of peche-pi
# This runs the packaged DMG version with the same state as the dev version

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$DESKTOP_DIR/release-dev"

# Find the .app bundle in the release directory
APP_PATH=$(find "$RELEASE_DIR" -name "*.app" -type d | head -1)

if [ -z "$APP_PATH" ]; then
    echo "No .app bundle found in $RELEASE_DIR"
    echo "Run 'pnpm package:dev' first to build the packaged version"
    exit 1
fi

echo "Launching: $APP_PATH"
open "$APP_PATH"
