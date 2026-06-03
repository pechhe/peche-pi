#!/usr/bin/env bash
set -euo pipefail

# Launch this checked-out pi-gui dev build as a separate app identity.
# This avoids clashing with /Applications/pi-gui.app and keeps state separate.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PI_APP_NAME="peche-pi"
export PI_APP_USER_DATA_DIR="$HOME/Library/Application Support/peche-pi"

mkdir -p "$PI_APP_USER_DATA_DIR"

cd "$REPO_ROOT"
exec bun run bun:dev
