import React from "react";
import OverlayComposer from "./overlay-composer";
import "./styles/overlay.css";

/**
 * Overlay route. Rendered in the always-on-top overlay BrowserWindow
 * instead of the full `App`. Shows the SessionComposer when an active
 * thread exists, or an empty state with a close button.
 */
export default function OverlayApp(): React.JSX.Element {
  return <OverlayComposer />;
}
