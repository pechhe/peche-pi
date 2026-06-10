import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ComposerPanel } from "./composer-panel";
import type { ComposerMode } from "./composer-mode";
import { parseTreeComposerCommand } from "./composer-commands";
import { readComposerAttachmentsFromFiles, extractImageFilesFromClipboardData, extractFilesFromDataTransfer } from "./composer-attachments";
import type {
  ComposerAttachment,
  ComposerDraftSyncSource,
  ComposerImageAttachment,
  DesktopAppState,
  ExtensionCommandCompatibilityRecord,
  QueuedComposerMessage,
  SessionExtensionDialogRecord,
  SessionRecord,
  WorkspaceRecord,
} from "./desktop-state";
import type { ModelSelectorHandle } from "./model-selector";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import type { SettingsSection } from "./settings-view";
import type { CavemanLevel, PiDesktopApi, SmartCompactSettings } from "./ipc";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { playClick } from "./button-click-sound";

/**
 * Imperative surface the host (App) uses to drive the composer draft without
 * owning its state. Keeping the draft inside this component means typing only
 * re-renders the composer subtree instead of the whole App + timeline.
 */
export interface SessionComposerHandle {
  /** Replace the draft (used by tree navigation: clear on open, restore on navigate). */
  readonly setDraft: (value: SetStateAction<string>) => void;
  /** Prefill the composer from a slash command (used by "Try skill"). */
  readonly fillFromSlash: (command: string) => void;
}

interface SessionComposerProps {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;

  readonly selectedSession: SessionRecord;
  readonly selectedWorkspace: WorkspaceRecord;
  readonly selectedSessionKey: string;

  readonly selectedRuntime: RuntimeSnapshot | undefined;
  readonly selectedModelRuntime: RuntimeSnapshot | undefined;
  readonly resolvedSessionProvider: string | undefined;
  readonly resolvedSessionModelId: string | undefined;
  readonly resolvedSessionThinkingLevel: string | undefined;
  readonly modelOnboarding: ModelOnboardingState;

  readonly selectedSessionCommands: readonly RuntimeCommandRecord[];
  readonly selectedWorkspaceCommandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly smartCompactSettings: SmartCompactSettings;

  readonly snapshotComposerAttachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;

  readonly cavemanLevel: CavemanLevel;
  /** Plan/build mode for this session, owned by the host so it survives submits. */
  readonly composerMode: ComposerMode;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly orchestratorMode?: boolean;
  readonly onToggleOrchestrator?: () => void;
  /** True once a plan-mode run has produced a plan and the session is idle. */
  readonly planReady: boolean;
  /** True once a plan-mode prompt has been submitted for this session (used to send full instructions only on first prompt). */
  readonly planAwaiting: boolean;
  /** Approve the written plan: sends an execute message + flips to build. */
  readonly onExecutePlan: () => void;
  /** Notify the host that a plan-mode message was just submitted. */
  readonly onPlanSubmitted: () => void;
  readonly runningLabel: string;
  // Draft persistence + cross-session sync (from snapshot).
  readonly hasSnapshot: boolean;
  readonly persistedComposerDraft: string;
  readonly composerDraftSyncNonce: number;
  readonly composerDraftSyncSource?: ComposerDraftSyncSource;

  // Refs + scroll coordination owned by App.
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly modelSelectorRef: RefObject<ModelSelectorHandle | null>;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly pinnedToBottomRef: MutableRefObject<boolean>;
  readonly preserveBottomOnNextPaneResizeRef: MutableRefObject<boolean>;
  readonly requestPinnedBottomAlignment: (
    behavior?: ScrollBehavior,
    options?: { readonly preferExactRestore?: boolean },
  ) => void;
  readonly focusComposer: () => void;

  // App-owned callbacks.
  readonly openTreeModal: () => void;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly handleClipboardImageShortcut: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ) => boolean;
  readonly questionnaireRequest?: Extract<SessionExtensionDialogRecord, { readonly kind: "questionnaire" }>;
  readonly onRespondToQuestionnaire?: (response: import("@pi-gui/session-driver").HostUiResponse) => void;
  readonly onUnarchiveSession?: (target: { workspaceId: string; sessionId: string }) => void;
  readonly chassisActions?: readonly import("./chassis").ChassisAction[];
  readonly onRunChassisAction?: (action: import("./chassis").ChassisAction) => void;
  readonly activeWrapId?: string | null;
  readonly onToggleChassisWrap?: (action: import("./chassis").ChassisAction) => void;
  readonly activeWrapTemplate?: string | null;
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}

const SessionComposerInner = forwardRef<SessionComposerHandle, SessionComposerProps>(function SessionComposer(
  {
    api,
    setSnapshot,
    updateSnapshot,
    selectedSession,
    selectedWorkspace,
    selectedSessionKey,
    selectedRuntime,
    selectedModelRuntime,
    resolvedSessionProvider,
    resolvedSessionModelId,
    resolvedSessionThinkingLevel,
    modelOnboarding,
    selectedSessionCommands,
    selectedWorkspaceCommandCompatibility,
    smartCompactSettings,
    snapshotComposerAttachments,
    queuedMessages,
    editingQueuedMessageId,
    cavemanLevel,
    composerMode,
    onSetComposerMode,
    orchestratorMode,
    onToggleOrchestrator,
    planReady,
    planAwaiting,
    onExecutePlan,
    onPlanSubmitted,
    runningLabel,
    hasSnapshot,
    persistedComposerDraft,
    composerDraftSyncNonce,
    composerDraftSyncSource,
    composerRef,
    modelSelectorRef,
    timelinePaneRef,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    requestPinnedBottomAlignment,
    focusComposer,
    openTreeModal,
    openSettings,
    onSetModel,
    onSetThinking,
    onSetCavemanLevel,
    onOpenModelSettings,
    handleClipboardImageShortcut,
    questionnaireRequest,
    onRespondToQuestionnaire,
    onUnarchiveSession,
    chassisActions,
    onRunChassisAction,
    activeWrapId,
    onToggleChassisWrap,
    activeWrapTemplate,
  },
  ref,
) {
  const [composerDraft, setComposerDraft] = useState("");
  // While a submit is in flight the snapshot still lists the attachments the
  // backend hasn't cleared yet; hide them optimistically so the chips vanish
  // the instant the user sends (but newly pasted attachments still render).
  const [submitClearedAttachmentIds, setSubmitClearedAttachmentIds] = useState<readonly string[] | null>(null);
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const composerAutoGrowHeightRef = useRef(0);
  const composerDraftLengthRef = useRef(0);
  const lastComposerElementRef = useRef<HTMLTextAreaElement | null>(null);

  const composerAttachments = (() => {
    if (!submitClearedAttachmentIds) {
      return snapshotComposerAttachments;
    }
    const cleared = new Set(submitClearedAttachmentIds);
    return snapshotComposerAttachments.filter((attachment) => !cleared.has(attachment.id));
  })();

  const slashMenu = useSlashMenu({
    composerDraft,
    setComposerDraft,
    selectedRuntime,
    selectedModelRuntime,
    sessionCommands: selectedSessionCommands,
    commandCompatibility: selectedWorkspaceCommandCompatibility,
    selectedSessionKey,
    selectedSession,
    selectedWorkspace,
    isRunning: selectedSession.status === "running",
    api,
    setSnapshot,
    focusComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: true,
    onRunTreeCommand: openTreeModal,
  });

  const mentionMenu = useMentionMenu({
    composerDraft,
    setComposerDraft,
    composerRef,
    workspaceId: selectedWorkspace.id,
    api,
  });

  useImperativeHandle(
    ref,
    () => ({
      setDraft: (value) => setComposerDraft(value),
      fillFromSlash: (command) => slashMenu.fillComposerFromSlash(command),
    }),
    [slashMenu],
  );

  // Hydrate / sync the draft across session switches and backend-driven edits.
  useEffect(() => {
    if (!hasSnapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = composerDraftSyncNonce;
      setComposerDraft(persistedComposerDraft);
      return;
    }

    if (composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = composerDraftSyncNonce;
    if (composerDraftSyncSource === "persist" || composerDraftSyncSource === "state") {
      return;
    }

    setComposerDraft(persistedComposerDraft);
  }, [hasSnapshot, selectedSessionKey, persistedComposerDraft, composerDraftSyncNonce, composerDraftSyncSource]);

  // Debounced persistence of the draft to the backend.
  useEffect(() => {
    if (!api || composerDraft === persistedComposerDraft) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void api.updateComposerDraft(composerDraft);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [api, composerDraft, persistedComposerDraft]);

  // Auto-grow the textarea and keep the timeline pinned to the bottom when the
  // composer height changes.
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    // Auto-grow without thrashing layout on every keystroke. Resetting the
    // height to "auto" to measure forces a full reflow (the composer height
    // feeds the timeline pane), so we only do it when the draft could have
    // shrunk. While the draft only grows, reading scrollHeight against the
    // current fixed height already reports the full content height, so the
    // common in-line keystroke neither writes the height nor reflows the pane.
    const elementChanged = lastComposerElementRef.current !== composer;
    lastComposerElementRef.current = composer;
    const previousHeight = elementChanged ? 0 : composerAutoGrowHeightRef.current;
    const previousLength = composerDraftLengthRef.current;
    composerDraftLengthRef.current = composerDraft.length;

    let nextHeight: number;
    if (composerDraft.length > previousLength && previousHeight > 0) {
      const measured = Math.min(composer.scrollHeight, 400);
      if (measured <= previousHeight) {
        return undefined;
      }
      nextHeight = measured;
    } else {
      composer.style.height = "auto";
      nextHeight = Math.min(composer.scrollHeight, 400);
    }

    if (Math.abs(nextHeight - previousHeight) < 1) {
      if (previousHeight > 0) {
        composer.style.height = `${previousHeight}px`;
      }
      return undefined;
    }

    composerAutoGrowHeightRef.current = nextHeight;
    composer.style.height = `${nextHeight}px`;

    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane
      ? isNearBottom(pane) || pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current
      : pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current;

    if (previousHeight > 0 && shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    }
  }, [composerDraft, requestPinnedBottomAlignment, composerRef, pinnedToBottomRef, timelinePaneRef, preserveBottomOnNextPaneResizeRef]);

  async function addAttachmentsToSessionComposer(files: File[]) {
    if (!api) {
      return;
    }
    const valid = await readComposerAttachmentsFromFiles(files);
    if (valid.length === 0) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments(valid));
  }

  const submitComposerDraft = (options: { readonly deliverAs?: "steer" | "followUp" } = {}) => {
    const hasComposerInput = composerDraft.trim().length > 0 || composerAttachments.length > 0;
    if (selectedSession.status === "running" && !hasComposerInput) {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.cancelCurrentRun());
      return;
    }

    if (!hasComposerInput) {
      return;
    }
    if (modelOnboarding.requiresModelSelection) {
      return;
    }

    const treeCommand = parseTreeComposerCommand(composerDraft);
    if (treeCommand?.type === "error") {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              lastError: treeCommand.message,
            }
          : current,
      );
      return;
    }
    if (treeCommand?.type === "tree") {
      openTreeModal();
      return;
    }

    if (!api) {
      return;
    }

    // Unarchive the session if it's archived — bring it back to active threads.
    if (selectedSession.archivedAt && onUnarchiveSession) {
      onUnarchiveSession({ workspaceId: selectedWorkspace.id, sessionId: selectedSession.id });
    }

    const previousDraft = composerDraft;
    const submitMode = composerMode;
    const isFirstPlanPrompt = submitMode === "plan" && !planAwaiting;
    if (submitMode === "plan") {
      onPlanSubmitted();
    }
    const clearedIds = composerAttachments.map((attachment) => attachment.id);
    setComposerDraft("");
    setSubmitClearedAttachmentIds(clearedIds);
    void (async () => {
      const nextState = await updateSnapshot(api, setSnapshot, () =>
        api.submitComposer(
          previousDraft,
          selectedSession.status === "running"
            ? { deliverAs: options.deliverAs ?? "followUp", mode: submitMode, isFirstPlanPrompt, wrapTemplate: activeWrapTemplate ?? undefined }
            : { mode: submitMode, isFirstPlanPrompt, wrapTemplate: activeWrapTemplate ?? undefined },
        ),
      );
      setComposerDraft(nextState.composerDraft);
      setSubmitClearedAttachmentIds(null);
    })().catch(() => {
      setComposerDraft(previousDraft);
      setSubmitClearedAttachmentIds(null);
    });
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.removeComposerAttachment(attachmentId));
  };

  const handleEditQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.editQueuedComposerMessage(messageId, composerDraft)).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleCancelQueuedEdit = () => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.cancelQueuedComposerEdit()).then(() => {
      composerRef.current?.focus();
    });
  };

  const handleRemoveQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.removeQueuedComposerMessage(messageId));
  };

  const handleSteerQueuedMessage = (messageId: string) => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.steerQueuedComposerMessage(messageId));
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void addAttachmentsToSessionComposer(files);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    void addAttachmentsToSessionComposer(files);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      handleClipboardImageShortcut(event, (clipboardImage) => {
        if (!api) {
          return;
        }
        void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
      })
    ) {
      return;
    }

    if (mentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (slashMenu.handleSlashKeyDown(event)) {
      return;
    }

    if (event.key === "Escape" && selectedSession.status === "running") {
      event.preventDefault();
      if (api) {
        void updateSnapshot(api, setSnapshot, () => api.cancelCurrentRun());
      }
      return;
    }

    // Holding Enter auto-repeats keydown; submit only on the initial press.
    // (The held-down button visual is handled by physical-key-feedback.)
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.repeat
    ) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && selectedSession.status === "running") {
      event.preventDefault();
      playClick("down");
      submitComposerDraft({ deliverAs: event.metaKey || event.ctrlKey ? "steer" : "followUp" });
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!composerDraft.trim() && composerAttachments.length === 0) {
      playClick("down");
      return;
    }
    if (modelOnboarding.requiresModelSelection) {
      return;
    }

    playClick("down");
    submitComposerDraft();
  };

  return (
    <ComposerPanel
      key={selectedSessionKey}
      activeSlashCommand={slashMenu.activeSlashFlow?.command}
      activeSlashCommandMeta={slashMenu.activeSlashFlow?.command?.description}
      attachments={composerAttachments}
      queuedMessages={queuedMessages}
      editingQueuedMessageId={editingQueuedMessageId}
      composerDraft={composerDraft}
      setComposerDraft={setComposerDraft}
      composerRef={composerRef}
      modelSelectorRef={modelSelectorRef}
      runtime={selectedModelRuntime}
      provider={resolvedSessionProvider}
      modelId={resolvedSessionModelId}
      thinkingLevel={resolvedSessionThinkingLevel}
      cavemanLevel={cavemanLevel}
      composerMode={composerMode}
      orchestratorMode={orchestratorMode}
      onToggleOrchestrator={onToggleOrchestrator}
      smartCompactSettings={smartCompactSettings}
      chassisActions={chassisActions}
      onRunChassisAction={onRunChassisAction}
      activeWrapId={activeWrapId}
      onToggleChassisWrap={onToggleChassisWrap}
      onClearSlashCommand={slashMenu.resetSlashUi}
      onComposerKeyDown={handleComposerKeyDown}
      onComposerPaste={handleComposerPaste}
      onComposerDrop={handleComposerDrop}
      onRemoveAttachment={handleRemoveAttachment}
      onEditQueuedMessage={handleEditQueuedMessage}
      onCancelQueuedEdit={handleCancelQueuedEdit}
      onRemoveQueuedMessage={handleRemoveQueuedMessage}
      onSteerQueuedMessage={handleSteerQueuedMessage}
      onSelectSlashCommand={(command) => {
        slashMenu.applySlashCommandSelection(command, "click");
      }}
      onSelectSlashOption={(option) => {
        slashMenu.applySlashOptionSelection(option);
      }}
      onSetModel={onSetModel}
      onSetThinking={onSetThinking}
      onSetCavemanLevel={onSetCavemanLevel}
      onSetComposerMode={onSetComposerMode}
      planReady={planReady}
      onExecutePlan={onExecutePlan}
      modelOnboarding={modelOnboarding}
      onOpenModelSettings={onOpenModelSettings}
      onSubmit={submitComposerDraft}
      runningLabel={runningLabel}
      selectedSession={selectedSession}
      selectedSlashCommand={slashMenu.activeSlashOptionCommand ?? slashMenu.selectedSlashCommand}
      selectedSlashOption={slashMenu.selectedSlashOption}
      slashOptionEmptyState={slashMenu.slashOptionEmptyState}
      showSlashOptionMenu={slashMenu.showSlashOptionMenu}
      showSlashMenu={slashMenu.showSlashMenu}
      slashOptions={slashMenu.slashOptions}
      slashSections={slashMenu.slashSections}
      showMentionMenu={mentionMenu.showMentionMenu}
      mentionOptions={mentionMenu.mentionOptions}
      selectedMentionIndex={mentionMenu.selectedIndex}
      onSelectMention={mentionMenu.insertMention}
      questionnaireRequest={questionnaireRequest}
      onRespondToQuestionnaire={onRespondToQuestionnaire}
      onCompactNow={api ? () => { void updateSnapshot(api, setSnapshot, () => api.submitComposer("/compact")); } : undefined}
    />
  );
});

function sameAttachments(
  left: readonly ComposerAttachment[],
  right: readonly ComposerAttachment[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((attachment, index) => attachment.id === right[index]?.id);
}

function sameQueuedMessages(
  left: readonly QueuedComposerMessage[],
  right: readonly QueuedComposerMessage[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((message, index) => {
    const other = right[index];
    return other !== undefined && message.id === other.id && message.text === other.text && message.mode === other.mode;
  });
}

function sameSessionComposerProps(
  previous: SessionComposerProps,
  next: SessionComposerProps,
): boolean {
  const previousContext = previous.selectedSession.contextUsage;
  const nextContext = next.selectedSession.contextUsage;
  return (
    previous.api === next.api &&
    previous.selectedSessionKey === next.selectedSessionKey &&
    previous.selectedSession.status === next.selectedSession.status &&
    previous.selectedSession.config?.provider === next.selectedSession.config?.provider &&
    previous.selectedSession.config?.modelId === next.selectedSession.config?.modelId &&
    previous.selectedSession.config?.thinkingLevel === next.selectedSession.config?.thinkingLevel &&
    previousContext?.usedTokens === nextContext?.usedTokens &&
    previousContext?.contextWindow === nextContext?.contextWindow &&
    previous.selectedWorkspace.id === next.selectedWorkspace.id &&
    previous.selectedRuntime === next.selectedRuntime &&
    previous.selectedModelRuntime === next.selectedModelRuntime &&
    previous.resolvedSessionProvider === next.resolvedSessionProvider &&
    previous.resolvedSessionModelId === next.resolvedSessionModelId &&
    previous.resolvedSessionThinkingLevel === next.resolvedSessionThinkingLevel &&
    previous.modelOnboarding === next.modelOnboarding &&
    previous.selectedSessionCommands === next.selectedSessionCommands &&
    previous.selectedWorkspaceCommandCompatibility === next.selectedWorkspaceCommandCompatibility &&
    previous.smartCompactSettings === next.smartCompactSettings &&
    sameAttachments(previous.snapshotComposerAttachments, next.snapshotComposerAttachments) &&
    sameQueuedMessages(previous.queuedMessages, next.queuedMessages) &&
    previous.editingQueuedMessageId === next.editingQueuedMessageId &&
    previous.cavemanLevel === next.cavemanLevel &&
    previous.composerMode === next.composerMode &&
    previous.onSetComposerMode === next.onSetComposerMode &&
    previous.planReady === next.planReady &&
    previous.planAwaiting === next.planAwaiting &&
    previous.onExecutePlan === next.onExecutePlan &&
    previous.onPlanSubmitted === next.onPlanSubmitted &&
    previous.runningLabel === next.runningLabel &&

    previous.hasSnapshot === next.hasSnapshot &&
    previous.persistedComposerDraft === next.persistedComposerDraft &&
    previous.composerDraftSyncNonce === next.composerDraftSyncNonce &&
    previous.composerDraftSyncSource === next.composerDraftSyncSource &&
    previous.composerRef === next.composerRef &&
    previous.modelSelectorRef === next.modelSelectorRef &&
    previous.timelinePaneRef === next.timelinePaneRef &&
    previous.pinnedToBottomRef === next.pinnedToBottomRef &&
    previous.preserveBottomOnNextPaneResizeRef === next.preserveBottomOnNextPaneResizeRef &&
    previous.requestPinnedBottomAlignment === next.requestPinnedBottomAlignment &&
    previous.focusComposer === next.focusComposer &&
    previous.openTreeModal === next.openTreeModal &&
    previous.openSettings === next.openSettings &&
    previous.onSetModel === next.onSetModel &&
    previous.onSetThinking === next.onSetThinking &&
    previous.onSetCavemanLevel === next.onSetCavemanLevel &&
    previous.onOpenModelSettings === next.onOpenModelSettings &&
    previous.handleClipboardImageShortcut === next.handleClipboardImageShortcut &&
    previous.questionnaireRequest === next.questionnaireRequest &&
    previous.onRespondToQuestionnaire === next.onRespondToQuestionnaire &&
    previous.onUnarchiveSession === next.onUnarchiveSession &&
    previous.orchestratorMode === next.orchestratorMode &&
    previous.onToggleOrchestrator === next.onToggleOrchestrator &&
    previous.chassisActions === next.chassisActions &&
    previous.onRunChassisAction === next.onRunChassisAction &&
    previous.activeWrapId === next.activeWrapId &&
    previous.onToggleChassisWrap === next.onToggleChassisWrap &&
    previous.activeWrapTemplate === next.activeWrapTemplate
  );
}

export const SessionComposer = memo(SessionComposerInner, sameSessionComposerProps);
