import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { SessionComposer, type SessionComposerHandle } from "./session-composer";
import { useDesktopAppState, updateSnapshot, useRunningLabel } from "./App";
import { deriveOverlayComposerProps } from "./overlay-composer-props";
import { getEffectiveModelRuntime } from "./model-settings";
import { buildModelOptions } from "./composer-commands";
import { deriveModelOnboardingState } from "./model-onboarding";
import { useSettingsHandlers } from "./hooks/use-settings-handlers";
import type { ComposerMode } from "./composer-mode";
import type { ComposerImageAttachment } from "./desktop-state";
import type { ModelSelectorHandle } from "./model-selector";
import type { CavemanLevel, SmartCompactSettings } from "./ipc";

/**
 * Overlay route composer. Renders the same `SessionComposer` as the main
 * window, driven by the same `DesktopAppStore` over IPC, so threads and model
 * changes made here appear in the main window automatically. It deliberately
 * renders none of the main-window chrome (sidebar, topbar, timeline, panels) —
 * just the composer, a minimal thread title, a running indicator (inside the
 * composer), and a close button.
 */
export default function OverlayComposer(): React.JSX.Element {
  const [snapshot, setSnapshot] = useDesktopAppState();
  const api = window.piApp;

  const [composerMode, setComposerMode] = useState<ComposerMode>("build");
  const [cavemanLevel, setCavemanLevel] = useState<CavemanLevel>("off");
  const [smartCompactSettings, setSmartCompactSettings] = useState<SmartCompactSettings>({});

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSelectorRef = useRef<ModelSelectorHandle | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const sessionComposerRef = useRef<SessionComposerHandle>(null);

  const derived = deriveOverlayComposerProps(snapshot);

  // Hooks must run unconditionally, before the early return below.
  const runningLabel = useRunningLabel(
    derived && derived.selectedSession.status === "running"
      ? derived.selectedSession.runningSince
      : undefined,
  );
  const settingsHandlers = useSettingsHandlers({
    api,
    setSnapshot,
    updateSnapshot,
    settingsWorkspace: derived?.selectedWorkspace,
    selectedWorkspace: derived?.selectedWorkspace,
    selectedSession: derived?.selectedSession,
    setThemeMode: () => {},
  });

  useEffect(() => {
    if (!api) return;
    void api.getCavemanConfig().then((config) => {
      setCavemanLevel(config.enabled ? config.defaultLevel : "off");
    });
    void api.getSmartCompactSettings().then(setSmartCompactSettings).catch(() => {});
  }, [api]);

  const closeOverlay = useCallback(() => {
    void api?.closeOverlay();
  }, [api]);

  const focusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

  const handleClipboardImageShortcut = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, onImage: (attachment: ComposerImageAttachment) => void): boolean => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "v") {
        return false;
      }
      const clipboardImage = api?.readClipboardImage();
      if (!clipboardImage) {
        return false;
      }
      event.preventDefault();
      onImage(clipboardImage);
      return true;
    },
    [api],
  );

  // Model-catalog derivations (same logic as App), kept here because they pull
  // in the model catalog graph and are proven on the real Electron surface.
  const selectedModelRuntime = snapshot && derived
    ? getEffectiveModelRuntime(snapshot, derived.selectedWorkspace)
    : undefined;
  const selectedDefaultEnabled = useMemo(
    () =>
      buildModelOptions(selectedModelRuntime).some(
        (m) =>
          m.providerId === selectedModelRuntime?.settings.defaultProvider &&
          m.modelId === selectedModelRuntime?.settings.defaultModelId,
      ),
    [selectedModelRuntime],
  );

  if (!api || !snapshot || !derived) {
    return (
      <div data-testid="overlay-root" className="overlay-root overlay-root--empty">
        <button type="button" className="overlay-close" onClick={closeOverlay} aria-label="Close overlay">
          ✕
        </button>
        <p className="overlay-empty">No active thread</p>
      </div>
    );
  }

  const { selectedWorkspace, selectedSession, selectedSessionKey } = derived;
  const resolvedSessionProvider =
    derived.resolvedSessionProvider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    derived.resolvedSessionModelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    derived.resolvedSessionThinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const modelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });

  return (
    <div data-testid="overlay-root" className="overlay-root">
      <header className="overlay-header">
        <span className="overlay-title" data-testid="overlay-thread-title">
          {selectedSession.title}
        </span>
        <button type="button" className="overlay-close" onClick={closeOverlay} aria-label="Close overlay">
          ✕
        </button>
      </header>
      <SessionComposer
        ref={sessionComposerRef}
        api={api}
        setSnapshot={setSnapshot}
        updateSnapshot={updateSnapshot}
        selectedSession={selectedSession}
        selectedWorkspace={selectedWorkspace}
        selectedSessionKey={selectedSessionKey}
        selectedRuntime={derived.selectedRuntime}
        selectedModelRuntime={selectedModelRuntime}
        resolvedSessionProvider={resolvedSessionProvider}
        resolvedSessionModelId={resolvedSessionModelId}
        resolvedSessionThinkingLevel={resolvedSessionThinkingLevel}
        modelOnboarding={modelOnboarding}
        selectedSessionCommands={derived.selectedSessionCommands}
        selectedWorkspaceCommandCompatibility={derived.selectedWorkspaceCommandCompatibility}
        smartCompactSettings={smartCompactSettings}
        snapshotComposerAttachments={derived.snapshotComposerAttachments}
        queuedMessages={derived.queuedMessages}
        editingQueuedMessageId={derived.editingQueuedMessageId}
        cavemanLevel={cavemanLevel}
        composerMode={composerMode}
        onSetComposerMode={setComposerMode}
        orchestratorMode={snapshot.subagentSettings.orchestratorMode}
        onToggleOrchestrator={() =>
          settingsHandlers.handleSetSubagentSettings({
            orchestratorMode: !snapshot.subagentSettings.orchestratorMode,
          })
        }
        planReady={false}
        planAwaiting={false}
        onExecutePlan={() => {}}
        onPlanSubmitted={() => {}}
        runningLabel={runningLabel}
        hasSnapshot={Boolean(snapshot)}
        persistedComposerDraft={derived.persistedComposerDraft}
        composerDraftSyncNonce={derived.composerDraftSyncNonce}
        composerDraftSyncSource={derived.composerDraftSyncSource}
        composerRef={composerRef}
        modelSelectorRef={modelSelectorRef}
        timelinePaneRef={timelinePaneRef}
        pinnedToBottomRef={pinnedToBottomRef}
        preserveBottomOnNextPaneResizeRef={preserveBottomOnNextPaneResizeRef}
        requestPinnedBottomAlignment={() => {}}
        focusComposer={focusComposer}
        openTreeModal={() => {}}
        openSettings={() => {}}
        onSetModel={settingsHandlers.handleSetSessionModel}
        onSetThinking={settingsHandlers.handleSetSessionThinking}
        onSetCavemanLevel={(level) => {
          setCavemanLevel(level);
          settingsHandlers.handleSetSessionCavemanLevel(level);
        }}
        onOpenModelSettings={() => {}}
        handleClipboardImageShortcut={handleClipboardImageShortcut}
      />
    </div>
  );
}
