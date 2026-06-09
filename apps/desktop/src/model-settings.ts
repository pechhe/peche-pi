import type { ModelSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, WorkspaceRecord } from "./desktop-state";

function applyModelSettings(
  runtime: RuntimeSnapshot | undefined,
  modelSettings: ModelSettingsSnapshot | undefined,
): RuntimeSnapshot | undefined {
  if (!runtime) {
    return undefined;
  }
  if (!modelSettings) {
    return runtime;
  }
  return {
    ...runtime,
    settings: {
      ...runtime.settings,
      ...(modelSettings.defaultProvider ? { defaultProvider: modelSettings.defaultProvider } : { defaultProvider: undefined }),
      ...(modelSettings.defaultModelId ? { defaultModelId: modelSettings.defaultModelId } : { defaultModelId: undefined }),
      ...(modelSettings.defaultThinkingLevel
        ? { defaultThinkingLevel: modelSettings.defaultThinkingLevel }
        : { defaultThinkingLevel: undefined }),
      enabledModelPatterns: [...modelSettings.enabledModelPatterns],
    },
  };
}

export function getEffectiveModelRuntime(
  state: Pick<
    DesktopAppState,
    "runtimeByWorkspace" | "modelSettingsScopeMode" | "globalModelSettings" | "workspaces"
  >,
  workspace: WorkspaceRecord | undefined,
): RuntimeSnapshot | undefined {
  if (!workspace) {
    return undefined;
  }
  const runtime = state.runtimeByWorkspace[workspace.id];
  if (!runtime) {
    return undefined;
  }
  if (state.modelSettingsScopeMode === "app-global") {
    return applyModelSettings(runtime, state.globalModelSettings);
  }
  return runtime;
}
