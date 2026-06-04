#!/bin/bash
# Launch the dev-packaged build of Peche Pi with its own userData path.
# This avoids the single-instance lock collision with `bun dev`.

APP="/Users/admin/Documents/2. coding projects.nosync/peche-pi/apps/desktop/release-dev/mac-arm64/peche-pi.app"
exec env PI_APP_NAME="Peche Pi" open "$APP"
