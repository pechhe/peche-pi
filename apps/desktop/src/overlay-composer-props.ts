import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type ComposerAttachment,
  type DesktopAppState,
  type ExtensionCommandCompatibilityRecord,
  type QueuedComposerMessage,
  type SessionRecord,
  type WorkspaceRecord,
} from "./desktop-state.ts";

/**
 * Composer props derived purely from a {@link DesktopAppState} snapshot.
 *
 * These mirror the snapshot-only derivations in `App.tsx` so the overlay window
 * can render the same `SessionComposer` against the same shared store without
 * depending on the rest of App's state. Pure + side-effect free so it can be
 * unit-tested without a renderer.
 *
 * Model-catalog logic (effective runtime, onboarding state, default-model
 * fallbacks) is intentionally left to the React `OverlayComposer`, which reuses
 * the same helpers `App` does. Those helpers pull in the model catalog graph
 * and are exercised on the real Electron surface rather than in node `--test`.
 */
export interface OverlayComposerDerived {
  readonly selectedWorkspace: WorkspaceRecord;
  readonly selectedSession: SessionRecord;
  readonly selectedSessionKey: string;
  readonly selectedRuntime: RuntimeSnapshot | undefined;
  /** Raw provider/model/thinking from the session config (no default fallback). */
  readonly resolvedSessionProvider: string | undefined;
  readonly resolvedSessionModelId: string | undefined;
  readonly resolvedSessionThinkingLevel: string | undefined;
  readonly selectedSessionCommands: readonly RuntimeCommandRecord[];
  readonly selectedWorkspaceCommandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly snapshotComposerAttachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly persistedComposerDraft: string;
  readonly composerDraftSyncNonce: number;
  readonly composerDraftSyncSource: DesktopAppState["composerDraftSyncSource"];
}

export function deriveOverlayComposerProps(
  snapshot: DesktopAppState | null,
): OverlayComposerDerived | null {
  if (!snapshot) {
    return null;
  }
  const selectedWorkspace = getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0];
  const selectedSession = getSelectedSession(snapshot);
  if (!selectedWorkspace || !selectedSession) {
    return null;
  }

  const selectedSessionKey = `${selectedWorkspace.id}:${selectedSession.id}`;

  return {
    selectedWorkspace,
    selectedSession,
    selectedSessionKey,
    selectedRuntime: snapshot.runtimeByWorkspace[selectedWorkspace.id],
    resolvedSessionProvider: selectedSession.config?.provider,
    resolvedSessionModelId: selectedSession.config?.modelId,
    resolvedSessionThinkingLevel: selectedSession.config?.thinkingLevel,
    selectedSessionCommands: snapshot.sessionCommandsBySession[selectedSessionKey] ?? [],
    selectedWorkspaceCommandCompatibility:
      snapshot.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? [],
    snapshotComposerAttachments: snapshot.composerAttachments ?? [],
    queuedMessages: snapshot.queuedComposerMessages ?? [],
    editingQueuedMessageId: snapshot.editingQueuedMessageId,
    persistedComposerDraft: snapshot.composerDraft ?? "",
    composerDraftSyncNonce: snapshot.composerDraftSyncNonce ?? 0,
    composerDraftSyncSource: snapshot.composerDraftSyncSource,
  };
}
