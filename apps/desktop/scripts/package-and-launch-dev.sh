#!/bin/bash
# Build and launch the packaged dev version of peche-pi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DESKTOP_DIR"

echo "Building packaged dev version..."
pnpm package:dev

if [ $? -ne 0 ]; then
    echo "Build failed"
    exit 1
fi

echo ""
echo "Build complete. Launching..."
bash scripts/launch-dev-packaged.sh
