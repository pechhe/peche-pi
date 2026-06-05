import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState, WorkspaceRecord } from "../desktop-state";
import type { PiDesktopApi } from "../ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillsExtensionsHandlerDeps {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<import("../desktop-state").DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: NonNullable<typeof window.piApp>,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly skillsWorkspace: WorkspaceRecord | undefined;
  readonly extensionsWorkspace: WorkspaceRecord | undefined;
}

export interface SkillsExtensionsHandlers {
  readonly handleToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly handleOpenSkillFolder: (filePath: string) => void;
  readonly handleToggleExtension: (filePath: string, enabled: boolean) => void;
  readonly handleOpenExtensionFolder: (filePath: string) => void;
  readonly handleDeleteExtension: (filePath: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSkillsExtensionsHandlers({
  api,
  setSnapshot,
  updateSnapshot,
  skillsWorkspace,
  extensionsWorkspace,
}: SkillsExtensionsHandlerDeps): SkillsExtensionsHandlers {
  const handleToggleSkill = (filePath: string, enabled: boolean) => {
    if (!api || !skillsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setSkillEnabled(skillsWorkspace.id, filePath, enabled));
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!api || !skillsWorkspace) return;
    void api.openSkillInFinder(skillsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!api || !extensionsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!api || !extensionsWorkspace) return;
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleDeleteExtension = (filePath: string) => {
    if (!api || !extensionsWorkspace) return;
    if (typeof api.deleteExtension !== "function") {
      window.alert("Delete extension is not available. Please restart the app to pick up the latest changes.");
      return;
    }
    const confirmed = window.confirm("Delete this extension? This will permanently remove the extension files from disk.");
    if (!confirmed) return;

    updateSnapshot(api, setSnapshot, () => api.deleteExtension(extensionsWorkspace.id, filePath)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Failed to delete extension: ${message}`);
    });
  };

  return {
    handleToggleSkill,
    handleOpenSkillFolder,
    handleToggleExtension,
    handleOpenExtensionFolder,
    handleDeleteExtension,
  };
}
