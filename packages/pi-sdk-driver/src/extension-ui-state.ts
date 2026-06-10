import type { HostUiRequest } from "@pi-gui/session-driver";

export interface ExtensionUiWidgetState {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveComposer" | "belowComposer";
}

export interface ExtensionUiState {
  readonly statuses: Map<string, string>;
  readonly widgets: Map<string, ExtensionUiWidgetState>;
  title: string | undefined;
  editorText: string | undefined;
  /** An extension command is currently executing (generic activity bracket). */
  commandActive: boolean;
}

export type ExtensionUiDialogRequest = Extract<
  HostUiRequest,
  { readonly kind: "confirm" | "select" | "input" | "editor" | "questionnaire" }
>;

export function createEmptyExtensionUiState(): ExtensionUiState {
  return {
    statuses: new Map(),
    widgets: new Map(),
    title: undefined,
    editorText: undefined,
    commandActive: false,
  };
}

export function applyHostUiRequestToExtensionUiState(
  state: ExtensionUiState,
  request: HostUiRequest,
): void {
  switch (request.kind) {
    case "status":
      if (request.text) {
        state.statuses.set(request.key, request.text);
      } else {
        state.statuses.delete(request.key);
      }
      break;
    case "widget":
      if (request.lines && request.lines.length > 0) {
        state.widgets.set(request.key, {
          key: request.key,
          lines: [...request.lines],
          placement: request.placement ?? "aboveComposer",
        });
      } else {
        state.widgets.delete(request.key);
      }
      break;
    case "title":
      state.title = request.title;
      break;
    case "editorText":
      state.editorText = request.text;
      break;
    case "commandActivity":
      state.commandActive = request.active;
      break;
    default:
      break;
  }
}

export function isExtensionUiDialogRequest(request: HostUiRequest): request is ExtensionUiDialogRequest {
  return (
    request.kind === "confirm" ||
    request.kind === "select" ||
    request.kind === "input" ||
    request.kind === "editor" ||
    request.kind === "questionnaire"
  );
}
