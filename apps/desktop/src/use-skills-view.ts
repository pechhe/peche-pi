import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, WorkspaceRecord } from "./desktop-state";
import type { PiDesktopApi } from "./ipc";
import { resolveSkillsWorkspaceId, toggleSetMember } from "./skills-view-model.ts";

/**
 * View-model hook for the Skills surface.
 *
 * Owns the five pieces of UI-only state that the Skills view needs
 * (target workspace, query, show-disabled toggle, selected skill,
 * collapsed group set) and wires them to `window.piApp` intents.
 *
 * Pure derivations (filtering, grouping, workspace resolution) live in
 * `skills-view-model.ts` and are unit-tested there. This hook is the
 * thin React glue.
 *
 * Cross-feature behaviour (trying a slash command — which transitions
 * to the threads view and pre-fills the composer) is passed in via
 * `onTrySkill` so the hook does not couple to the composer's plumbing.
 */
export interface UseSkillsViewOptions {
  readonly snapshot: DesktopAppState | null;
  readonly rootWorkspaces: readonly WorkspaceRecord[];
  readonly api: PiDesktopApi | undefined;
  readonly updateSnapshotWith: (perform: () => Promise<DesktopAppState>) => void;
  readonly onTrySkill: (command: string) => void;
}

export interface UseSkillsViewResult {
  /** The workspace currently targeted by the Skills surface. */
  readonly workspace: WorkspaceRecord | undefined;
  /** Runtime for `workspace`, if available. */
  readonly runtime: RuntimeSnapshot | undefined;
  /** Props consumed by `<SkillsView>`. */
  readonly viewProps: {
    readonly workspace: WorkspaceRecord | undefined;
    readonly runtime: RuntimeSnapshot | undefined;
    readonly query: string;
    readonly onQueryChange: (value: string) => void;
    readonly showDisabled: boolean;
    readonly onShowDisabledChange: (value: boolean) => void;
    readonly collapsedGroups: ReadonlySet<string>;
    readonly onToggleGroup: (key: string) => void;
    readonly selectedSkillPath: string | undefined;
    readonly onSelectSkill: (filePath: string) => void;
    readonly onRefresh: () => void;
    readonly onOpenSkillFolder: (filePath: string) => void;
    readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
    readonly onTrySkill: (slashCommand: string) => void;
  };
  /**
   * Resolve a candidate workspace id and switch the Skills surface to
   * target it. Callers are responsible for separately switching the
   * active view to `"skills"`.
   */
  readonly selectWorkspaceForSkills: (candidate?: string) => void;
  /** Direct setter for the target workspace id (used by the workspace dropdown). */
  readonly setWorkspaceId: Dispatch<SetStateAction<string>>;
}

export function useSkillsView(options: UseSkillsViewOptions): UseSkillsViewResult {
  const { snapshot, rootWorkspaces, api, updateSnapshotWith, onTrySkill } = options;

  const [workspaceId, setWorkspaceId] = useState("");
  const [query, setQuery] = useState("");
  const [showDisabled, setShowDisabled] = useState(true);
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | undefined>();
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  const workspace = workspaceId
    ? rootWorkspaces.find((entry) => entry.id === workspaceId)
    : undefined;
  const runtime = workspace ? snapshot?.runtimeByWorkspace[workspace.id] : undefined;

  const handleToggleGroup = useCallback((key: string) => {
    setCollapsedGroups((current) => toggleSetMember(current, key));
  }, []);

  const handleToggleSkill = useCallback(
    (filePath: string, enabled: boolean) => {
      if (!workspace || !api) return;
      updateSnapshotWith(() => api.setSkillEnabled(workspace.id, filePath, enabled));
    },
    [workspace, api, updateSnapshotWith],
  );

  const handleOpenSkillFolder = useCallback(
    (filePath: string) => {
      if (!workspace || !api) return;
      void api.openSkillInFinder(workspace.id, filePath);
    },
    [workspace, api],
  );

  const handleRefresh = useCallback(() => {
    if (!workspace || !api) return;
    updateSnapshotWith(() => api.refreshRuntime(workspace.id));
  }, [workspace, api, updateSnapshotWith]);

  const selectWorkspaceForSkills = useCallback(
    (candidate?: string) => {
      const next = resolveSkillsWorkspaceId(candidate, workspaceId, rootWorkspaces);
      if (next) {
        setWorkspaceId(next);
      }
    },
    [workspaceId, rootWorkspaces],
  );

  return {
    workspace,
    runtime,
    viewProps: {
      workspace,
      runtime,
      query,
      onQueryChange: setQuery,
      showDisabled,
      onShowDisabledChange: setShowDisabled,
      collapsedGroups,
      onToggleGroup: handleToggleGroup,
      selectedSkillPath,
      onSelectSkill: setSelectedSkillPath,
      onRefresh: handleRefresh,
      onOpenSkillFolder: handleOpenSkillFolder,
      onToggleSkill: handleToggleSkill,
      onTrySkill: (slashCommand) => onTrySkill(slashCommand),
    },
    selectWorkspaceForSkills,
    setWorkspaceId,
  };
}
