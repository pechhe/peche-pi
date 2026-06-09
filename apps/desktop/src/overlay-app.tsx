import React from "react";

/**
 * Minimal overlay route. Rendered in the always-on-top overlay BrowserWindow
 * instead of the full `App`. For Phase 1 lifecycle this is a placeholder that
 * proves the overlay route resolves and renders independently of the main App.
 */
export default function OverlayApp(): React.JSX.Element {
  return (
    <div data-testid="overlay-root" className="overlay-root">
      Overlay
    </div>
  );
}
