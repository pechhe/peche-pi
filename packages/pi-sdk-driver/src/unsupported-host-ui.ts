import type { ExtensionCompatibilityIssue } from "@pi-gui/session-driver";

const UNSUPPORTED_HOST_UI_PREFIX = "__PI_GUI_UNSUPPORTED_HOST_UI__:";

export function parseUnsupportedHostUiErrorMessage(message: string): ExtensionCompatibilityIssue | undefined {
  if (!message.startsWith(UNSUPPORTED_HOST_UI_PREFIX)) {
    return undefined;
  }

  try {
    return JSON.parse(message.slice(UNSUPPORTED_HOST_UI_PREFIX.length)) as ExtensionCompatibilityIssue;
  } catch {
    return undefined;
  }
}

