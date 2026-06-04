import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type SetStateAction } from "react";
import type { SessionTreeSnapshot } from "@pi-gui/session-driver/types";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
  type ComposerAttachment,
  type ComposerImageAttachment,
  type ContextSnapshot,
  type DesktopAppState,
  type NewThreadEnvironment,
  type SelectedTranscriptRecord,
  type SessionStatus,
  type StartChatInput,
  type StartThreadInput,
  type TranscriptMessage,
  type WorktreeRecord,
  type WorkspaceRecord,
} from "./desktop-state";
import { SessionComposer, type SessionComposerHandle } from "./session-composer";
import { buildPlanModePrompt, type ComposerMode } from "./composer-mode";
import { DiffPanel, type DiffPanelFileRequest } from "./diff-panel";
import { buildModelOptions, THINKING_OPTIONS } from "./composer-commands";
import { parseTreeComposerCommand } from "./composer-commands";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  getDesktopShortcutLabel,
  type DesktopNotificationPermissionStatus,
  type PiDesktopCommand,
  type CavemanLevel,
  type UndoEditOp,
} from "./ipc";
import { deriveModelOnboardingState } from "./model-onboarding";
import { type ModelSelectorHandle } from "./model-selector";
import { SkillsView } from "./skills-view";
import { ExtensionsView } from "./extensions-view";
import { ContextView } from "./context-view";
import { SettingsView, type SettingsSection } from "./settings-view";
import { NewThreadView } from "./new-thread-view";
import { PendingComposer } from "./pending-thread-view";
import { buildThreadGroups, PENDING_THREAD_SESSION_ID, type ThreadListEntry } from "./thread-groups";
import { usePendingThreadGoLive, captureHeroFlip, type PendingThreadStart } from "./hooks/use-pending-thread-go-live";
import { Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { playButtonClick, DEFAULT_BUTTON_SOUND_SETTINGS, type ButtonSoundSettings } from "./button-click-sound";
import { Topbar } from "./topbar";
import { TerminalPanel } from "./terminal-panel";
import { ConversationTimeline, VIRTUALIZATION_THRESHOLD } from "./conversation-timeline";
import LoadingBar from "./loading-bar";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { useNavigationHistory } from "./hooks/use-navigation-history";
import { installPhysicalKeyFeedback } from "./physical-key-feedback";
import { useRalphLoop, type RalphLaunch } from "./hooks/use-ralph-loop";
import { useSelfHealTranscript } from "./hooks/use-self-heal-transcript";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { ExtensionDialog } from "./extension-session-ui";
import { RalphLaunchDialog } from "./ralph-launch-dialog";
import { SubagentLiveProvider } from "./subagent-live";
import { TreeModal } from "./tree-modal";
import { ImageLightbox } from "./image-lightbox";
import { Agentation } from "agentation";
import { ToastHost, showToast } from "./toast";
import { notifyThreadComplete, OPEN_SESSION_EVENT, type OpenSessionDetail } from "./composer-completion-toast";
import { getEffectiveModelRuntime } from "./model-settings";
import { resolveRepoWorkspaceId } from "./workspace-roots";
import {
  extractImageFilesFromClipboardData,
  extractFilesFromDataTransfer,
  readComposerAttachmentsFromFiles,
} from "./composer-attachments";
import { applyDesktopLiveUpdate, applySelectedTranscriptLiveUpdate, applyTranscriptDelta, type TranscriptDelta } from "./live-update";

const EMPTY_TRANSCRIPT: readonly TranscriptMessage[] = Object.freeze([]) as readonly TranscriptMessage[];

// Title for the optimistic sidebar row, derived from the prompt the user just
// sent. Mirrors how the live thread reads before its auto-title resolves.
// Stable id for the optimistic user-message row shown in the timeline while a
// new thread is being created. Lets the placeholder transcript and the live
// transcript share one ConversationTimeline so going live reconciles instead
// of remounting.
// Default title the main process assigns a freshly created session until its
// auto-generated title resolves. Keep in sync with the source of truth in
// electron/thread-title-constants.ts (NEW_THREAD_PLACEHOLDER_TITLE).
const NEW_THREAD_PLACEHOLDER_TITLE = "New thread";

function deriveThreadTitle(prompt: string): string {
  const firstLine = prompt.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (!firstLine) {
    return NEW_THREAD_PLACEHOLDER_TITLE;
  }
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}\u2026` : firstLine;
}

function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    let pendingState: DesktopAppState | undefined;
    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAppliedStateRoute = "";
    const stateRoute = (state: DesktopAppState) =>
      `${state.activeView}:${state.selectedWorkspaceId ?? ""}:${state.selectedSessionId ?? ""}:${state.selectedChatId ?? ""}`;
    const clearStateCoalesce = () => {
      if (stateTimer !== null) {
        clearTimeout(stateTimer);
        stateTimer = null;
      }
    };
    const flushState = () => {
      clearStateCoalesce();
      if (!active || !pendingState) {
        pendingState = undefined;
        return;
      }
      const next = pendingState;
      pendingState = undefined;
      lastAppliedStateRoute = stateRoute(next);
      setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "snapshot", state: next }));
    };

    void Promise.all([api.getState(), api.getSelectedTranscript()])
      .then(([state, transcript]) => {
        if (!active) return;
        setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "snapshot", state }));
        lastAppliedStateRoute = stateRoute(state);
        lastAppliedSessionKey = transcript ? `${transcript.workspaceId}::${transcript.sessionId}` : null;
        setSelectedTranscript((current) => applySelectedTranscriptLiveUpdate(current, { type: "selected-transcript", payload: transcript }));
        // If a session is selected but transcript came back null, retry.
        if (!transcript && state.selectedSessionId) {
          void api.getSelectedTranscript().then((retried) => {
            if (active && retried) {
              lastAppliedSessionKey = `${retried.workspaceId}::${retried.sessionId}`;
              setSelectedTranscript(retried);
            }
          });
        }
      })
      .catch(() => {
        // Promise.all rejected (likely getSelectedTranscript threw).
        // Retry each call individually so state at least populates.
        if (!active) return;
        void api.getState().then((state) => {
          if (!active) return;
          setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "snapshot", state }));
          lastAppliedStateRoute = stateRoute(state);
          if (state.selectedSessionId) {
            void api.getSelectedTranscript().then((transcript) => {
              if (active && transcript) {
                lastAppliedSessionKey = `${transcript.workspaceId}::${transcript.sessionId}`;
                setSelectedTranscript((current) => applySelectedTranscriptLiveUpdate(current, { type: "selected-transcript", payload: transcript }));
              }
            });
          }
        });
      });

    const unsubscribeState = api.onStateChanged((state) => {
      if (!active) {
        return;
      }
      const nextRoute = stateRoute(state);
      if (nextRoute !== lastAppliedStateRoute) {
        pendingState = undefined;
        clearStateCoalesce();
        lastAppliedStateRoute = nextRoute;
        setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "navigation", state }));
        return;
      }
      pendingState = state;
      if (stateTimer === null) {
        stateTimer = setTimeout(flushState, 100);
      }
    });

    // Coalesce transcript updates: streaming deltas can fire many times per
    // frame (each text_delta from the model triggers a full-transcript IPC
    // publish on the main side). Without coalescing, React re-renders and
    // ReactMarkdown re-parses the entire active message per delta, which
    // visibly chunks long streamed replies. Buffer the latest payload and
    // flush at most once per animation frame.
    //
    // Session switches (payload === null, or a different sessionId) are
    // flushed immediately so a stale transcript can never leak into the next
    // session's view.
    let pendingTranscript: SelectedTranscriptRecord | null | undefined = undefined;
    let rafHandle: number | null = null;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAppliedSessionKey: string | null = null;

    const clearCoalesce = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      if (coalesceTimer !== null) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
      }
    };

    const flushTranscript = () => {
      clearCoalesce();
      if (!active || pendingTranscript === undefined) {
        pendingTranscript = undefined;
        return;
      }
      const next = pendingTranscript;
      pendingTranscript = undefined;
      lastAppliedSessionKey = next ? `${next.workspaceId}::${next.sessionId}` : null;
      setSelectedTranscript((current) => applySelectedTranscriptLiveUpdate(current, { type: "selected-transcript", payload: next }));
    };

    const applyTranscriptImmediately = (payload: SelectedTranscriptRecord | null) => {
      clearCoalesce();
      pendingTranscript = undefined;
      lastAppliedSessionKey = payload ? `${payload.workspaceId}::${payload.sessionId}` : null;
      setSelectedTranscript((current) => applySelectedTranscriptLiveUpdate(current, { type: "selected-transcript", payload }));
    };

    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (!active) {
        return;
      }
      const payloadKey = payload ? `${payload.workspaceId}::${payload.sessionId}` : null;
      // Session switch (including clear): apply immediately, never coalesce
      // across sessions.
      if (payloadKey !== lastAppliedSessionKey) {
        applyTranscriptImmediately(payload);
        return;
      }
      pendingTranscript = payload;
      // Throttle streaming deltas to one flush per frame via rAF, but back it
      // with a timeout: requestAnimationFrame is paused while the window is
      // backgrounded/occluded, which would otherwise strand this payload (the
      // "thread stuck blank until you switch away and back" bug).
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushTranscript);
      }
      if (coalesceTimer === null) {
        coalesceTimer = setTimeout(flushTranscript, 250);
      }
    });

    const unsubscribeStatePatch = api.onStatePatch((patch) => {
      if (!active) {
        return;
      }
      setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "workspace-session", workspaceId: patch.workspaceId, session: patch.session }));
    });

    // Transcript delta streaming: for the selected session, the main process
    // emits an initial full transcript followed by incremental deltas (new
    // messages only). This avoids re-sending the full transcript on every
    // streaming delta.
    let deltaTranscript: readonly TranscriptMessage[] | null = null;
    let deltaSessionKey: string | null = null;
    const unsubscribeTranscriptDelta = api.onTranscriptDelta((delta) => {
      if (!active) {
        return;
      }
      const incomingKey = `${delta.workspaceId}::${delta.sessionId}`;
      if (deltaSessionKey !== incomingKey) {
        deltaSessionKey = incomingKey;
        deltaTranscript = delta.messages;
      } else if (delta.initial) {
        deltaTranscript = delta.messages;
      } else {
        deltaTranscript = applyTranscriptDelta(deltaTranscript ?? [], delta);
      }
      // Update the transcript state with the delta-merged result.
      setSelectedTranscript(() => ({
        workspaceId: delta.workspaceId,
        sessionId: delta.sessionId,
        transcript: deltaTranscript!,
      }));
    });

    return () => {
      active = false;
      clearStateCoalesce();
      clearCoalesce();
      unsubscribeState();
      unsubscribeTranscript();
      unsubscribeStatePatch();
      unsubscribeTranscriptDelta();
    };
  }, []);

  return [snapshot, setSnapshot, selectedTranscript, setSelectedTranscript] as const;
}

function updateSnapshot(
  api: NonNullable<typeof window.piApp>,
  setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action().then((state) => {
    setSnapshot(state);
    return state;
  });
}

function doneSessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

// Force the given sessions to read as archived in a snapshot. Used as an
// optimistic guard while a "done" action is in flight: it keeps the row out of
// the active list even if a stale live-update patch (captured before the
// archive landed) briefly reports the session as un-archived, which otherwise
// makes the row flicker back.
function forceSessionsArchived(state: DesktopAppState, doneKeys: ReadonlySet<string>): DesktopAppState {
  if (doneKeys.size === 0) {
    return state;
  }
  const archivedAt = new Date().toISOString();
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    let workspaceChanged = false;
    const sessions = workspace.sessions.map((session) => {
      if (session.archivedAt || !doneKeys.has(doneSessionKey(workspace.id, session.id))) {
        return session;
      }
      workspaceChanged = true;
      return { ...session, archivedAt };
    });
    if (!workspaceChanged) {
      return workspace;
    }
    changed = true;
    return { ...workspace, sessions };
  });
  return changed ? { ...state, workspaces } : state;
}

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

function canTogglePrimarySidebar(view: AppView | undefined): boolean {
  return view === "threads" || view === "new-thread";
}

function useRunningLabel(startedAt: string | undefined) {
  const [label, setLabel] = useState(() => formatRunningLabel(startedAt));

  useEffect(() => {
    setLabel(formatRunningLabel(startedAt));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatRunningLabel(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt]);

  return label;
}

function formatRunningLabel(startedAt: string | undefined): string {
  if (!startedAt) {
    return "Working…";
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return `Working for ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `Working for ${minutes}m` : `Working for ${minutes}m ${remaining}s`;
}

export default function App() {
  const [snapshot, setSnapshot, selectedTranscript, setSelectedTranscript] = useDesktopAppState();
  const [newThreadComposerMode, setNewThreadComposerMode] = useState<ComposerMode>("build");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [cavemanLevel, setCavemanLevel] = useState<CavemanLevel>("off");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState("");
  const [skillsWorkspaceId, setSkillsWorkspaceId] = useState("");
  const [skillsQuery, setSkillsQuery] = useState("");
  const [skillsShowDisabled, setSkillsShowDisabled] = useState(true);
  const [skillsSelectedPath, setSkillsSelectedPath] = useState<string | undefined>();
  const [skillsCollapsedGroups, setSkillsCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  // Session keys (workspaceId:sessionId) marked "done" whose archive is still
  // being confirmed by the backend. Kept out of the active thread list to
  // avoid an optimistic-vs-live-update flicker.
  const [recentlyDone, setRecentlyDone] = useState<ReadonlySet<string>>(new Set());
  // sessionId → prompt-derived title for freshly created threads. Shown in the
  // sidebar while the session's title is still the "New thread" placeholder so
  // the title doesn't flash to "New thread" between the prompt title and the
  // auto-generated one. Pruned once the real title lands.
  const [newThreadTitleFallback, setNewThreadTitleFallback] = useState<Readonly<Record<string, string>>>({});
  const [extensionsWorkspaceId, setExtensionsWorkspaceId] = useState("");
  const [pendingNewThreadWorkspaceId, setPendingNewThreadWorkspaceId] = useState("");
  const [newThreadRootWorkspaceId, setNewThreadRootWorkspaceId] = useState("");
  const [newThreadIsChat, setNewThreadIsChat] = useState(false);
  const [newThreadEnvironment, setNewThreadEnvironment] = useState<NewThreadEnvironment>("local");
  const [ralphLaunch, setRalphLaunch] = useState<RalphLaunch | null>(null);
  // Per-project draft text + attachments. Keyed by rootWorkspaceId so each
  // project remembers what the user typed while navigating elsewhere.
  const [newThreadPromptByWorkspace, setNewThreadPromptByWorkspace] = useState<Record<string, string>>({});
  const [newThreadAttachmentsByWorkspace, setNewThreadAttachmentsByWorkspace] = useState<
    Record<string, readonly ComposerAttachment[]>
  >({});
  const newThreadPrompt = newThreadPromptByWorkspace[newThreadRootWorkspaceId] ?? "";
  const newThreadAttachments = newThreadAttachmentsByWorkspace[newThreadRootWorkspaceId] ?? [];
  const setNewThreadPrompt = useCallback(
    (value: SetStateAction<string>) => {
      setNewThreadPromptByWorkspace((prev) => {
        const key = newThreadRootWorkspaceId;
        if (!key) return prev;
        const current = prev[key] ?? "";
        const next = typeof value === "function" ? (value as (p: string) => string)(current) : value;
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [newThreadRootWorkspaceId],
  );
  const setNewThreadAttachments = useCallback(
    (value: SetStateAction<readonly ComposerAttachment[]>) => {
      setNewThreadAttachmentsByWorkspace((prev) => {
        const key = newThreadRootWorkspaceId;
        if (!key) return prev;
        const current = prev[key] ?? [];
        const next =
          typeof value === "function"
            ? (value as (p: readonly ComposerAttachment[]) => readonly ComposerAttachment[])(current)
            : value;
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [newThreadRootWorkspaceId],
  );
  const [newThreadProvider, setNewThreadProvider] = useState<string | undefined>();
  const [newThreadModelId, setNewThreadModelId] = useState<string | undefined>();
  const [newThreadThinkingLevel, setNewThreadThinkingLevel] = useState<string | undefined>();
  const [newThreadComposerError, setNewThreadComposerError] = useState<string | undefined>();
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark" | "dracula">("system");
  const [buttonSoundSettings, setButtonSoundSettings] = useState<ButtonSoundSettings>(
    () => ({ ...DEFAULT_BUTTON_SOUND_SETTINGS })
  );
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<DesktopNotificationPermissionStatus>("unknown");
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const [treeModalState, setTreeModalState] = useState<{
    readonly open: boolean;
    readonly loading: boolean;
    readonly submitting: boolean;
    readonly tree?: SessionTreeSnapshot;
    readonly error?: string;
  }>({
    open: false,
    loading: false,
    submitting: false,
  });
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const newThreadComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptMarkerRef = useRef("");
  const pinnedToBottomRef = useRef(true);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const previousActiveViewRef = useRef<AppView | null>(null);
  const sessionComposerRef = useRef<SessionComposerHandle>(null);
  const prevSessionStatusRef = useRef<Map<string, SessionStatus>>(new Map());
  const lastErrorToastKeyRef = useRef("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [openTerminalSessionKey, setOpenTerminalSessionKey] = useState("");
  const [takeoverTerminalSessionKey, setTakeoverTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const [diffRefreshNonce, setDiffRefreshNonce] = useState(0);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);
  const threadSearch = useThreadSearch(timelinePaneRef);
  const api = window.piApp;
  const sidebarToggleStateRef = useRef<{
    readonly api: typeof window.piApp;
    readonly activeView: AppView | undefined;
    readonly sidebarCollapsed: boolean;
  }>({
    api,
    activeView: undefined,
    sidebarCollapsed: false,
  });
  sidebarToggleStateRef.current = {
    api,
    activeView: snapshot?.activeView,
    sidebarCollapsed: snapshot?.sidebarCollapsed ?? false,
  };

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;

    void piApi.getCavemanConfig().then((config) => {
      setCavemanLevel(config.defaultLevel);
    });

    void piApi.getResolvedTheme().then((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    void piApi.getThemeMode().then((mode) => {
      setThemeMode(mode);
      document.documentElement.classList.toggle("dracula", mode === "dracula");
    });

    const unsub = piApi.onThemeChanged((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    });

    return unsub;
  }, []);

  useEffect(() => {
    if (snapshot) {
      document.documentElement.classList.toggle("enable-transparency", snapshot.enableTransparency);
    }
  }, [snapshot?.enableTransparency]);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    const mode = snapshot.composerDeviceMode;
    root.classList.toggle("composer-device", mode !== "off");
    root.classList.toggle("composer-device--screen", mode === "screen" || mode === "screen-neon");
    root.classList.toggle("composer-device--modular", mode === "modular" || mode === "modular-metal");
    root.classList.toggle("composer-device--metal-keys", mode === "modular-metal");
    root.classList.toggle("composer-device--neon", mode === "screen-neon");
  }, [snapshot?.composerDeviceMode]);

  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi?.onNotificationPermissionStatusChanged) {
      return;
    }

    return piApi.onNotificationPermissionStatusChanged((status) => {
      setNotificationPermissionStatus(status);
    });
  }, []);

  const refreshNotificationPermissionStatus = useCallback(() => {
    if (!api?.getNotificationPermissionStatus) {
      return Promise.resolve("unknown" as DesktopNotificationPermissionStatus);
    }

    return api.getNotificationPermissionStatus().then((status) => {
      setNotificationPermissionStatus(status);
      return status;
    });
  }, [api]);

  useEffect(() => {
    if (snapshot?.activeView !== "settings" || settingsSection !== "notifications") {
      return undefined;
    }

    void refreshNotificationPermissionStatus();
    return undefined;
  }, [refreshNotificationPermissionStatus, settingsSection, snapshot?.activeView]);

  const selectedWorkspace = snapshot ? (getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0]) : undefined;
  const selectedSession = snapshot ? (getSelectedSession(snapshot) ?? selectedWorkspace?.sessions[0]) : undefined;
  const chats = snapshot?.chats ?? [];
  // Sidebar-facing derivations depend only on workspaces/worktrees, not selection.
  // Keeping them off `selectedWorkspace` lets the memoized Sidebar skip re-renders
  // when the user just switches between sessions.
  const { linkedWorktreeByWorkspaceId, rootWorkspaceOptions, visibleWorkspaces } = useMemo(() => {
    if (!snapshot) {
      return {
        linkedWorktreeByWorkspaceId: new Map<string, WorktreeRecord>(),
        rootWorkspaceOptions: [] as readonly WorkspaceRecord[],
        visibleWorkspaces: [] as readonly WorkspaceRecord[],
      };
    }

    const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace] as const));
    const chatWorkspaceIds = new Set(
      snapshot.chats.map((chat) => chat.chatWorkspaceId).filter((id): id is string => Boolean(id)),
    );
    // Chat workspaces live under a "/chats/" directory in app support. Filter by
    // both the known chat ids and the path shape so leaked/unmigrated chat
    // workspaces never appear in the Threads list.
    const isChatWorkspace = (workspace: WorkspaceRecord): boolean =>
      chatWorkspaceIds.has(workspace.id) || /[/\\]chats[/\\][^/\\]+[/\\]?$/.test(workspace.path);
    const nonChatWorkspaces = snapshot.workspaces.filter((workspace) => !isChatWorkspace(workspace));
    const primaryWorkspaces = nonChatWorkspaces.filter((workspace) => workspace.kind === "primary");
    const orphanWorkspaces = nonChatWorkspaces.filter(
      (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
    );
    const nextVisibleWorkspaces =
      primaryWorkspaces.length > 0 ? [...primaryWorkspaces, ...orphanWorkspaces] : nonChatWorkspaces;
    const nextLinkedWorktreeByWorkspaceId = new Map(
      Object.values(snapshot.worktreesByWorkspace)
        .flat()
        .filter((worktree) => Boolean(worktree.linkedWorkspaceId))
        .map((worktree) => [worktree.linkedWorkspaceId as string, worktree] as const),
    );
    const nextRootWorkspaceOptions = [...new Set(nonChatWorkspaces.map((workspace) => resolveRepoWorkspaceId(nonChatWorkspaces, workspace.id) ?? workspace.id))]
      .map((workspaceId) => nonChatWorkspaces.find((workspace) => workspace.id === workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));

    return {
      linkedWorktreeByWorkspaceId: nextLinkedWorktreeByWorkspaceId,
      rootWorkspaceOptions: nextRootWorkspaceOptions,
      visibleWorkspaces: nextVisibleWorkspaces,
    };
  }, [snapshot]);

  // Selection-dependent derivations live separately so they can recompute
  // cheaply when the user switches sessions without invalidating Sidebar props.
  const { activeWorktrees, rootWorkspace } = useMemo(() => {
    if (!snapshot) {
      return {
        activeWorktrees: [] as readonly WorktreeRecord[],
        rootWorkspace: undefined as WorkspaceRecord | undefined,
      };
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
    const nextRootWorkspace =
      (nextRootWorkspaceId ? snapshot.workspaces.find((workspace) => workspace.id === nextRootWorkspaceId) : undefined)
      ?? selectedWorkspace;
    return {
      activeWorktrees: nextRootWorkspace ? snapshot.worktreesByWorkspace[nextRootWorkspace.id] ?? [] : [],
      rootWorkspace: nextRootWorkspace,
    };
  }, [selectedWorkspace, snapshot]);
  const selectedRuntime = selectedWorkspace ? snapshot?.runtimeByWorkspace[selectedWorkspace.id] : undefined;
  const rootRuntime = rootWorkspace ? snapshot?.runtimeByWorkspace[rootWorkspace.id] : undefined;
  const selectedModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, selectedWorkspace) : undefined;
  const selectedWorktree = selectedWorkspace ? linkedWorktreeByWorkspaceId.get(selectedWorkspace.id) : undefined;
  const settingsWorkspace = settingsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === settingsWorkspaceId)
    : undefined;
  const skillsWorkspace = skillsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === skillsWorkspaceId)
    : undefined;
  const extensionsWorkspace = extensionsWorkspaceId
    ? rootWorkspaceOptions.find((workspace) => workspace.id === extensionsWorkspaceId)
    : undefined;
  const settingsRuntime = settingsWorkspace ? snapshot?.runtimeByWorkspace[settingsWorkspace.id] : undefined;
  const settingsModelRuntime = snapshot ? getEffectiveModelRuntime(snapshot, settingsWorkspace) : undefined;
  const skillsRuntime = skillsWorkspace ? snapshot?.runtimeByWorkspace[skillsWorkspace.id] : undefined;
  const extensionsRuntime = extensionsWorkspace ? snapshot?.runtimeByWorkspace[extensionsWorkspace.id] : undefined;
  const contextWorkspace = selectedWorkspace
    ? rootWorkspaceOptions.find((workspace) => workspace.id === (selectedWorkspace.rootWorkspaceId ?? selectedWorkspace.id)) ?? selectedWorkspace
    : undefined;
  const contextRuntime = contextWorkspace ? snapshot?.runtimeByWorkspace[contextWorkspace.id] : undefined;
  const [contextSnapshot, setContextSnapshot] = useState<ContextSnapshot | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const loadContextSnapshot = useCallback(() => {
    if (!contextWorkspace || !api) {
      setContextSnapshot(null);
      return;
    }
    setContextLoading(true);
    void api
      .getContextSnapshot(contextWorkspace.id, selectedSession?.id)
      .then((snap) => setContextSnapshot(snap))
      .catch(() => setContextSnapshot(null))
      .finally(() => setContextLoading(false));
  }, [api, contextWorkspace, selectedSession?.id]);
  useEffect(() => {
    if (snapshot?.activeView === "context") {
      loadContextSnapshot();
    }
  }, [snapshot?.activeView, loadContextSnapshot]);
  const extensionsCommandCompatibility = extensionsWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[extensionsWorkspace.id] ?? []
    : [];
  const newThreadWorkspace =
    rootWorkspaceOptions.find((entry) => entry.id === newThreadRootWorkspaceId) ?? rootWorkspaceOptions[0];
  const newThreadRuntime = snapshot ? getEffectiveModelRuntime(snapshot, newThreadWorkspace) : undefined;
  const newThreadDefaultEnabled = buildModelOptions(newThreadRuntime).some(
    (m) => m.providerId === newThreadRuntime?.settings.defaultProvider && m.modelId === newThreadRuntime?.settings.defaultModelId,
  );
  const selectedDefaultEnabled = buildModelOptions(selectedModelRuntime).some(
    (m) => m.providerId === selectedModelRuntime?.settings.defaultProvider && m.modelId === selectedModelRuntime?.settings.defaultModelId,
  );
  const resolvedSessionProvider =
    selectedSession?.config?.provider ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultProvider : undefined);
  const resolvedSessionModelId =
    selectedSession?.config?.modelId ??
    (selectedDefaultEnabled ? selectedModelRuntime?.settings.defaultModelId : undefined);
  const resolvedSessionThinkingLevel =
    selectedSession?.config?.thinkingLevel ?? selectedModelRuntime?.settings.defaultThinkingLevel;
  const resolvedNewThreadProvider = newThreadProvider ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultProvider : undefined);
  const resolvedNewThreadModelId = newThreadModelId ?? (newThreadDefaultEnabled ? newThreadRuntime?.settings.defaultModelId : undefined);
  // New threads default to medium reasoning so the model emits thinking_delta
  // events the timeline can render as a collapsed "Thought" disclosure.
  // Per-model clamping (clampThinkingLevel in pi-sdk-driver) falls back to
  // whatever level the model actually supports, including "off", so this is
  // safe to apply universally. Users can still pick a different level in the
  // composer or override the default in settings.
  const resolvedNewThreadThinkingLevel =
    newThreadThinkingLevel ?? newThreadRuntime?.settings.defaultThinkingLevel ?? "medium";
  const selectedSessionModelOnboarding = deriveModelOnboardingState(selectedModelRuntime, {
    provider: resolvedSessionProvider,
    modelId: resolvedSessionModelId,
  });
  const newThreadModelOnboarding = deriveModelOnboardingState(newThreadRuntime, {
    provider: resolvedNewThreadProvider,
    modelId: resolvedNewThreadModelId,
  });
  const snapshotComposerAttachments = snapshot?.composerAttachments ?? [];
  const queuedComposerMessages = snapshot?.queuedComposerMessages ?? [];
  const editingQueuedMessageId = snapshot?.editingQueuedMessageId;
  const runningLabel = useRunningLabel(selectedSession?.status === "running" ? selectedSession.runningSince : undefined);
  const selectedSessionKey = selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : "";
  const snapshotLastError = snapshot?.lastError;
  const composerLastError = isRequestAbortedError(snapshotLastError) ? undefined : snapshotLastError;
  const isTerminalVisibleForSelectedThread = Boolean(selectedSessionKey) && openTerminalSessionKey === selectedSessionKey;
  const isTerminalTakeoverForSelectedThread = Boolean(selectedSessionKey) && takeoverTerminalSessionKey === selectedSessionKey;
  const activeTranscript =
    selectedTranscript &&
    selectedWorkspace &&
    selectedSession &&
    selectedTranscript.workspaceId === selectedWorkspace.id &&
    selectedTranscript.sessionId === selectedSession.id
      ? selectedTranscript.transcript
      : EMPTY_TRANSCRIPT;
  // In clean mode (default), hide noise-tagged activities (extension chatter
  // like blackhole OM progress and cymbal nudges). Verbose mode shows them.
  const transcriptVerbose = snapshot?.transcriptVerbose ?? false;
  const visibleTranscript = useMemo(
    () =>
      transcriptVerbose
        ? activeTranscript
        : activeTranscript.filter((item) => !(item.kind === "activity" && item.noise)),
    [activeTranscript, transcriptVerbose],
  );
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscript ||
    selectedTranscript.workspaceId !== selectedWorkspace?.id ||
    selectedTranscript.sessionId !== selectedSession?.id
  );
  const {
    pendingThreadStart,
    setPendingThreadStart,
    pendingOptimisticTranscript,
    threadViewTranscript,
    threadViewIsRunning,
    composerFlipFromRef,
    heroFlipFromRef,
  } = usePendingThreadGoLive(
    selectedTranscript,
    selectedSession,
    visibleTranscript,
    composerRef,
    snapshot?.threadTransition,
  );
  useSelfHealTranscript(isTranscriptLoading, selectedWorkspace?.id, selectedSession?.id, setSelectedTranscript);
  const selectedSessionCommands = selectedSession ? snapshot?.sessionCommandsBySession[selectedSessionKey] ?? [] : [];
  const blackholeAvailable = selectedSessionCommands.some((command) => command.name === "blackhole");
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];
  useEffect(() => {
    if (snapshot && snapshot.workspaces.length === 0) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
    }
  }, [snapshot]);
  useEffect(() => {
    if (!snapshotLastError) {
      return;
    }
    const toastKey = `${selectedSessionKey}:${snapshotLastError}`;
    if (lastErrorToastKeyRef.current === toastKey) {
      return;
    }
    lastErrorToastKeyRef.current = toastKey;
    showToast({ variant: "error", message: snapshotLastError, autoDismissMs: 6000 });
  }, [selectedSessionKey, snapshotLastError]);
  // In-app "thread finished" detection: fire a composer toast + chime when a
  // background thread transitions out of "running". Edge-detection on the
  // previous snapshot's status naturally dedupes; the currently-selected
  // thread is skipped (you're already watching it).
  useEffect(() => {
    if (!snapshot) return;
    const previousStatuses = prevSessionStatusRef.current;
    const nextStatuses = new Map<string, SessionStatus>();
    const preferences = snapshot.notificationPreferences;
    const selectedKey = `${snapshot.selectedWorkspaceId}:${snapshot.selectedSessionId}`;
    let firstFinishedSession: { workspaceId: string; sessionId: string } | null = null;
    for (const workspace of snapshot.workspaces) {
      for (const session of workspace.sessions) {
        const key = `${workspace.id}:${session.id}`;
        nextStatuses.set(key, session.status);
        const before = previousStatuses.get(key);
        if (before !== "running" || session.status === "running" || key === selectedKey) {
          continue;
        }
        // Queue mode: auto-navigate to first finished session with unseen update
        if (snapshot.queueMode && session.hasUnseenUpdate && !firstFinishedSession) {
          firstFinishedSession = { workspaceId: workspace.id, sessionId: session.id };
        }
        if (session.status === "idle" && preferences.backgroundCompletion) {
          notifyThreadComplete({
            variant: "completion",
            title: session.title,
            workspaceId: workspace.id,
            sessionId: session.id,
          });
        } else if (session.status === "failed" && preferences.backgroundFailure) {
          notifyThreadComplete({
            variant: "failure",
            title: session.title,
            workspaceId: workspace.id,
            sessionId: session.id,
          });
        }
      }
    }
    // Navigate to first finished session in queue mode
    if (firstFinishedSession) {
      void api?.selectSession(firstFinishedSession).then(() => {
        focusComposer();
      });
    }
    prevSessionStatusRef.current = nextStatuses;
  }, [snapshot]);
  useEffect(() => {
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
  }, [selectedSessionKey]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeHostDialog = selectedExtensionUi?.pendingDialogs[0];
  const activeQuestionnaireRequest = activeHostDialog?.kind === "questionnaire" ? activeHostDialog : undefined;
  const activeExtensionDialog = activeHostDialog?.kind !== "questionnaire" ? activeHostDialog : undefined;
  const persistedComposerDraft = snapshot?.composerDraft ?? "";
  // Drop "done" guards once the snapshot confirms the session is archived (or
  // gone), so the real backend state takes over from the optimistic override.
  useEffect(() => {
    if (recentlyDone.size === 0 || !snapshot) {
      return;
    }
    const stillPending = new Set<string>();
    for (const key of recentlyDone) {
      const session = snapshot.workspaces
        .flatMap((workspace) => workspace.sessions.map((s) => ({ workspaceId: workspace.id, session: s })))
        .find((entry) => doneSessionKey(entry.workspaceId, entry.session.id) === key);
      if (session && !session.session.archivedAt) {
        stillPending.add(key);
      }
    }
    if (stillPending.size !== recentlyDone.size) {
      setRecentlyDone(stillPending);
    }
  }, [snapshot, recentlyDone]);

  // Drop prompt-title fallbacks once the auto-generated title lands (or the
  // session disappears).
  useEffect(() => {
    const ids = Object.keys(newThreadTitleFallback);
    if (ids.length === 0 || !snapshot) {
      return;
    }
    const titleById = new Map(
      snapshot.workspaces.flatMap((workspace) => workspace.sessions.map((s) => [s.id, s.title] as const)),
    );
    const next: Record<string, string> = {};
    for (const id of ids) {
      const title = titleById.get(id);
      // Keep the fallback only while the session still shows the placeholder.
      if (title === NEW_THREAD_PLACEHOLDER_TITLE) {
        next[id] = newThreadTitleFallback[id]!;
      }
    }
    if (Object.keys(next).length !== ids.length) {
      setNewThreadTitleFallback(next);
    }
  }, [snapshot, newThreadTitleFallback]);

  const threadGroups = useMemo(
    () => {
      const effective = snapshot ? forceSessionsArchived(snapshot, recentlyDone) : null;
      const built = effective ? buildThreadGroups(effective) : [];
      // Replace the "New thread" placeholder title with the prompt-derived one
      // until the auto-generated title resolves.
      const groups =
        Object.keys(newThreadTitleFallback).length === 0
          ? built
          : built.map((group) => ({
              ...group,
              threads: group.threads.map((thread) => {
                const fallback = newThreadTitleFallback[thread.session.id];
                return fallback && thread.session.title === NEW_THREAD_PLACEHOLDER_TITLE
                  ? { ...thread, session: { ...thread.session, title: fallback } }
                  : thread;
              }),
            }));
      // Optimistic sidebar row: while a new thread is still being created,
      // show a running placeholder in its workspace so the thread appears
      // immediately rather than after it goes live.
      if (!pendingThreadStart || !pendingThreadStart.rootWorkspaceId) {
        return groups;
      }
      // Once the real session materialises in the snapshot, drop the sentinel
      // and instead overlay the real row (see below). The main process selects
      // the new session and can push it via a live-update *before* startThread's
      // promise sets `sessionId`; matching on the freshly selected session
      // avoids the placeholder and real row coexisting for a frame.
      const selectedId = effective?.selectedSessionId;
      const realId =
        pendingThreadStart.sessionId ??
        (selectedId &&
        selectedId !== PENDING_THREAD_SESSION_ID &&
        selectedId !== pendingThreadStart.priorSelectedSessionId &&
        groups.some((group) => group.threads.some((thread) => thread.session.id === selectedId))
          ? selectedId
          : undefined);
      if (realId) {
        // The real session exists. Don't inject the sentinel row; instead keep
        // its row "running" through the create→first-token gap (the backend
        // emits the new session before the message dispatch flips it to
        // running) and keep the prompt title until the generated one lands, so
        // the spinner never pauses and the title never flashes "New thread".
        const pendingTitle = pendingThreadStart.title;
        return groups.map((group) => ({
          ...group,
          threads: group.threads.map((thread) =>
            thread.session.id === realId
              ? {
                  ...thread,
                  session: {
                    ...thread.session,
                    status: "running" as const,
                    title:
                      thread.session.title === NEW_THREAD_PLACEHOLDER_TITLE ? pendingTitle : thread.session.title,
                  },
                }
              : thread,
          ),
        }));
      }
      const optimistic: ThreadListEntry = {
        workspaceId: pendingThreadStart.rootWorkspaceId,
        session: {
          id: PENDING_THREAD_SESSION_ID,
          title: pendingThreadStart.title,
          updatedAt: new Date().toISOString(),
          preview: "",
          status: "running",
          hasUnseenUpdate: false,
          isAwaitingAssistantText: true,
        },
        environment: { kind: "local", label: "Local" },
      };
      return groups.map((group) =>
        group.rootWorkspace.id === pendingThreadStart.rootWorkspaceId
          ? { ...group, threads: [optimistic, ...group.threads] }
          : group,
      );
    },
    [snapshot?.workspaces, snapshot?.worktreesByWorkspace, snapshot?.workspaceOrder, snapshot?.chats, snapshot?.selectedSessionId, pendingThreadStart, recentlyDone, newThreadTitleFallback],
  );
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  };
  const toggleTerminal = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (openTerminalSessionKey === selectedSessionKey) {
      setOpenTerminalSessionKey("");
      setTakeoverTerminalSessionKey("");
      return;
    }
    setOpenTerminalSessionKey(selectedSessionKey);
  }, [openTerminalSessionKey, selectedSessionKey]);
  const openExternalTerminal = useCallback(() => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.openSessionInDefaultTerminal());
  }, [api, setSnapshot]);
  const focusNewThreadComposer = () => {
    window.requestAnimationFrame(() => {
      newThreadComposerRef.current?.focus();
    });
  };
  const resetExactBottomRestoreState = (nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  };
  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadComposerError(undefined);
    setNewThreadPrompt(value);
  }, [setNewThreadPrompt]);
  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const align = (remainingChecks: number) => {
      if (behavior === "auto") {
        pane.scrollTop = pane.scrollHeight;
      } else {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      }
      pinnedToBottomRef.current = true;
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, true);
      setShowJumpToLatest(false);

      if (remainingChecks <= 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        if (remaining > 1 || remainingChecks > 1) {
          align(remainingChecks - 1);
        }
      });
    };

    align(6);
  }, [selectedSessionKey]);

  const requestPinnedBottomAlignment = useCallback((
    behavior: ScrollBehavior = "auto",
    options?: { readonly preferExactRestore?: boolean },
  ) => {
    if (exactBottomRestoreSessionKeyRef.current === selectedSessionKey && selectedSessionKey) {
      pendingPinnedBottomBehaviorRef.current = behavior;
      deferredPinnedBottomAlignmentRef.current = true;
      return;
    }

    if (options?.preferExactRestore && selectedSessionKey && activeTranscript.length > VIRTUALIZATION_THRESHOLD) {
      exactBottomRestoreSessionKeyRef.current = selectedSessionKey;
      pendingPinnedBottomBehaviorRef.current = behavior;
      preserveBottomOnNextPaneResizeRef.current = true;
      setDisableTimelineVirtualization(true);
      return;
    }

    scrollTimelineToBottom(behavior);
  }, [activeTranscript.length, scrollTimelineToBottom, selectedSessionKey]);

  const finalizeTimelineVirtualizationDisable = useCallback(() => {
    const pane = timelinePaneRef.current;
    const restoreSessionKey = exactBottomRestoreSessionKeyRef.current;
    if (!pane || snapshot?.activeView !== "threads") {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    if (restoreSessionKey !== selectedSessionKey || !restoreSessionKey) {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom =
      pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current || deferredPinnedBottomAlignmentRef.current;
    if (!shouldRestoreBottom) {
      resetExactBottomRestoreState();
      setDisableTimelineVirtualization(false);
      return;
    }

    const finishRestore = (remainingChecks: number, stableChecks: number) => {
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
          return;
        }

        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          scrollTimelineToBottom();
        }

        const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
        const nextStableChecks = remaining <= 16 ? stableChecks + 1 : 0;
        if (remainingChecks <= 1 || nextStableChecks >= 2) {
          const shouldApplyDeferredAlignment = deferredPinnedBottomAlignmentRef.current;
          resetExactBottomRestoreState();
          if (shouldApplyDeferredAlignment) {
            scrollTimelineToBottom();
          }
          preserveBottomOnNextPaneResizeRef.current = false;
          return;
        }

        finishRestore(remainingChecks - 1, nextStableChecks);
      });
    };

    if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
      scrollTimelineToBottom();
    }

    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== pane || exactBottomRestoreSessionKeyRef.current !== restoreSessionKey) {
        return;
      }
      setDisableTimelineVirtualization(false);
      scrollTimelineToBottom(pendingPinnedBottomBehaviorRef.current);
      pendingPinnedBottomBehaviorRef.current = "auto";
      finishRestore(6, 0);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) {
      return;
    }

    setTimelinePaneMountVersion((current) => current + 1);

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || snapshot?.activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = (savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current;
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) {
          return;
        }
        if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
          requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        }
      });
      return;
    }

    if (savedScrollTop == null) {
      setDisableTimelineVirtualization(false);
      return;
    }

    node.scrollTop = savedScrollTop;
    pinnedToBottomRef.current = false;
    resetExactBottomRestoreState();
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, false);
    window.requestAnimationFrame(() => {
      if (timelinePaneRef.current !== node) {
        return;
      }
      setDisableTimelineVirtualization(false);
    });
  }, [scrollTimelineToBottom, selectedSessionKey, snapshot?.activeView]);

  const schedulePinnedBottomRealignment = useCallback((delayFrames = 0) => {
    const waitForFrames = (remainingFrames: number) => {
      window.requestAnimationFrame(() => {
        if (remainingFrames > 0) {
          waitForFrames(remainingFrames - 1);
          return;
        }
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          preserveBottomOnNextPaneResizeRef.current = false;
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    waitForFrames(delayFrames);
  }, [requestPinnedBottomAlignment]);

  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);

  const handleUndoEdits = useCallback(
    async (ops: readonly UndoEditOp[]) => {
      const workspaceId = selectedWorkspaceRef.current?.id;
      if (!api || !workspaceId) {
        return { reverted: [], failed: [] };
      }
      const result = await api.undoEdits(workspaceId, ops);
      setDiffRefreshNonce((nonce) => nonce + 1);
      return result;
    },
    [api],
  );

  const handleRedoEdits = useCallback(
    async (ops: readonly UndoEditOp[]) => {
      const workspaceId = selectedWorkspaceRef.current?.id;
      if (!api || !workspaceId) {
        return { reverted: [], failed: [] };
      }
      const result = await api.redoEdits(workspaceId, ops);
      setDiffRefreshNonce((nonce) => nonce + 1);
      return result;
    },
    [api],
  );

  const toggleDiffPanel = useCallback(() => {
    const pane = timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || pinnedToBottomRef.current : pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
    }

    setShowDiffPanel((prev) => !prev);

    if (!shouldPreserveBottom) {
      return;
    }

    schedulePinnedBottomRealignment(3);
  }, [schedulePinnedBottomRealignment]);

  const openSettings = (workspaceId?: string, section?: SettingsSection) => {
    if (!api) {
      return;
    }
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : settingsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSettingsWorkspaceId(nextWorkspaceId);
    }
    if (section) {
      setSettingsSection(section);
    }
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("settings"));
  };

  const closeTreeModal = useCallback(() => {
    setTreeModalState((current) =>
      current.submitting
        ? current
        : {
            open: false,
            loading: false,
            submitting: false,
          },
    );
    focusComposer();
  }, []);

  const openTreeModal = useCallback(() => {
    if (!api || !selectedWorkspace || !selectedSession) {
      return;
    }

    setTreeModalState({
      open: true,
      loading: true,
      submitting: false,
    });
    sessionComposerRef.current?.setDraft("");

    void api
      .getSessionTree({
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      })
      .then((tree) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          tree,
        });
      })
      .catch((error) => {
        setTreeModalState({
          open: true,
          loading: false,
          submitting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, selectedSession, selectedWorkspace]);

  const navigateTreeSelection = useCallback(
    (targetId: string, options?: { readonly summarize?: boolean; readonly customInstructions?: string }) => {
      if (!api || !selectedWorkspace || !selectedSession) {
        return;
      }

      setTreeModalState((current) => ({ ...current, submitting: true, error: undefined }));
      void api
        .navigateSessionTree(
          {
            workspaceId: selectedWorkspace.id,
            sessionId: selectedSession.id,
          },
          targetId,
          options,
        )
        .then(({ state, result }) => {
          setSnapshot(state);
          setTreeModalState({
            open: false,
            loading: false,
            submitting: false,
          });
          sessionComposerRef.current?.setDraft((current) =>
            !current.trim() && result.editorText ? result.editorText : state.composerDraft,
          );
          focusComposer();
        })
        .catch((error) => {
          setTreeModalState((current) => ({
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [api, selectedSession, selectedWorkspace],
  );

  const newThreadSlashMenu = useSlashMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: updateNewThreadPrompt,
    selectedRuntime: newThreadRuntime,
    selectedModelRuntime: newThreadRuntime,
    sessionCommands: [],
    commandCompatibility: [],
    selectedSessionKey: `new-thread:${newThreadWorkspace?.id ?? ""}`,
    selectedSession: undefined,
    selectedWorkspace: newThreadWorkspace,
    isRunning: false,
    api,
    setSnapshot,
    focusComposer: focusNewThreadComposer,
    openSettings,
    updateSnapshot,
    allowTreeCommand: false,
    immediateCommandMode: "prefill",
    onSelectModelOption: (provider, modelId) => {
      setNewThreadProvider(provider);
      setNewThreadModelId(modelId);
    },
    onSelectThinkingOption: setNewThreadThinkingLevel,
    onSelectLoginProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.loginProvider(newThreadWorkspace.id, providerId));
    },
    onSelectLogoutProvider: (providerId) => {
      if (!api || !newThreadWorkspace) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.logoutProvider(newThreadWorkspace.id, providerId));
    },
  });

  const newThreadMentionMenu = useMentionMenu({
    composerDraft: newThreadPrompt,
    setComposerDraft: setNewThreadPrompt,
    composerRef: newThreadComposerRef,
    workspaceId: newThreadWorkspace?.id,
    api,
  });

  const wsMenu = useWorkspaceMenu({
    api,
    setSnapshot,
    updateSnapshot,
  });

  useEffect(() => {
    if (rootWorkspaceOptions.length === 0) {
      setSettingsWorkspaceId("");
      setSkillsWorkspaceId("");
      setExtensionsWorkspaceId("");
      setPendingNewThreadWorkspaceId("");
      setNewThreadRootWorkspaceId("");
      setNewThreadEnvironment("local");
      // No workspaces left — wipe all per-workspace drafts.
      setNewThreadPromptByWorkspace({});
      setNewThreadAttachmentsByWorkspace({});
      return;
    }
    setSettingsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setSkillsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setExtensionsWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
    setNewThreadRootWorkspaceId((current) =>
      rootWorkspaceOptions.some((workspace) => workspace.id === current) ? current : (current || rootWorkspaceOptions[0]?.id || ""),
    );
  }, [rootWorkspaceOptions]);

  useEffect(() => {
    if (!snapshot || !pendingNewThreadWorkspaceId) {
      return;
    }
    const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, pendingNewThreadWorkspaceId);
    if (!nextRootWorkspaceId || !rootWorkspaceOptions.some((workspace) => workspace.id === nextRootWorkspaceId)) {
      return;
    }
    setNewThreadRootWorkspaceId(nextRootWorkspaceId);
    setPendingNewThreadWorkspaceId("");
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot]);

  const resetNewThreadSurface = (workspaceId?: string) => {
    const nextWorkspaceId =
      (workspaceId && (
        rootWorkspaceOptions.find((workspace) => workspace.id === workspaceId)?.id ||
        (snapshot ? resolveRepoWorkspaceId(snapshot.workspaces, workspaceId) : undefined)
      )) ||
      rootWorkspace?.id ||
      visibleWorkspaces[0]?.id ||
      "";
    if (nextWorkspaceId) {
      setNewThreadRootWorkspaceId(nextWorkspaceId);
    }
    setNewThreadEnvironment("local");
    // Draft text + attachments are per-project (see
    // newThreadPromptByWorkspace) and intentionally preserved here so that
    // navigating away and back to the new-thread surface keeps what the
    // user typed. They are cleared only on successful submit.
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerMode("build");
    setNewThreadComposerError(undefined);
  };

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    const sidebarState = sidebarToggleStateRef.current;
    const sidebarApi = sidebarState.api;
    if (!sidebarApi || !canTogglePrimarySidebar(sidebarState.activeView)) {
      return false;
    }
    void updateSnapshot(sidebarApi, setSnapshot, () => sidebarApi.setSidebarCollapsed(!sidebarState.sidebarCollapsed));
    return true;
  }, []);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "B") : "";
  const modelSelectorRef = useRef<ModelSelectorHandle | null>(null);
  const selectedSessionRef = useRef(selectedSession);
  const selectedWorkspaceRef = useRef(selectedWorkspace);
  selectedSessionRef.current = selectedSession;
  selectedWorkspaceRef.current = selectedWorkspace;

  const navigationHistory = useNavigationHistory(snapshot);
  const sidebarResize = useSidebarWidth();
  const navigateToEntry = useCallback(
    (entry: { activeView: AppView; selectedWorkspaceId: string; selectedSessionId: string }) => {
      if (!api) {
        return;
      }
      if (entry.activeView === "threads") {
        // selectSession sets workspace + session + activeView="threads" in one shot.
        void updateSnapshot(api, setSnapshot, () =>
          api.selectSession({ workspaceId: entry.selectedWorkspaceId, sessionId: entry.selectedSessionId }),
        );
        return;
      }
      // Non-threads views don't change selectedWorkspaceId/selectedSessionId,
      // so just switching the view is enough.
      void updateSnapshot(api, setSnapshot, () => api.setActiveView(entry.activeView));
    },
    [api],
  );

  useEffect(() => installPhysicalKeyFeedback(), []);

  useEffect(() => {
    const cycleThinking = () => {
      const session = selectedSessionRef.current;
      const workspace = selectedWorkspaceRef.current;
      if (!session || !workspace || !api) return;
      const currentLevel = session.config?.thinkingLevel ?? "off";
      // Filter THINKING_OPTIONS to only include levels the current model supports
      const runtime = workspace ? snapshot?.runtimeByWorkspace[workspace.id] : undefined;
      const modelRecord = runtime?.models.find(
        (m) => m.providerId === session.config?.provider && m.modelId === session.config?.modelId,
      );
      const availableLevels = modelRecord?.availableThinkingLevels ?? ["off", "low", "medium", "high", "xhigh"];
      const cycleable = THINKING_OPTIONS.filter((opt) => availableLevels.includes(opt.value));
      if (cycleable.length === 0) return;
      const currentIndex = cycleable.findIndex((opt) => opt.value === currentLevel);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cycleable.length : 0;
      const next = cycleable[nextIndex];
      if (next) {
        void api.setSessionThinkingLevel(workspace.id, session.id, next.value as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>);
      }
    };

    const handleCommand = (command: PiDesktopCommand): boolean => {
      if (command === desktopCommands.openSettings) {
        openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.openNewThread) {
        openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id);
        return true;
      } else if (command === desktopCommands.toggleTerminal) {
        toggleTerminal();
        return true;
      } else if (command === desktopCommands.toggleSidebar) {
        return handleTogglePrimarySidebar();
      } else if (command === desktopCommands.commitAndPush) {
        window.dispatchEvent(new CustomEvent("pi:commit-and-push"));
        return true;
      }
      return false;
    };

    const removeCommandListener = window.piApp?.onCommand?.(handleCommand);
    const removeWorkspacePickedListener = window.piApp?.onWorkspacePicked?.((workspaceId) => {
      setPendingNewThreadWorkspaceId(workspaceId);
      resetNewThreadSurface();
    });
    const removeClipboardImageListener = window.piApp?.onClipboardImagePasted?.(handlePastedClipboardImage);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEventInsideTerminal(event)) {
        const command = getDesktopCommandFromShortcut({
          modifier: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          key: event.key,
          code: event.code,
        });
        if (command === desktopCommands.toggleTerminal) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      // Cmd+F toggles thread search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        if (threadSearch.isOpen) {
          threadSearch.close();
        } else {
          threadSearch.open();
        }
        return;
      }
      // Cmd+D toggles diff panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleDiffPanel();
        return;
      }
      // Cmd+T opens model picker (outside terminal)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t" && !event.shiftKey) {
        event.preventDefault();
        modelSelectorRef.current?.openModelDropdown();
        return;
      }
      // Shift+Tab cycles thinking level
      if (event.key === "Tab" && event.shiftKey && !(event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        cycleThinking();
        return;
      }
      // Cmd+[ / Cmd+] navigates back/forward through location history.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key === "[") {
          const target = navigationHistory.goBack();
          if (target) {
            event.preventDefault();
            navigateToEntry(target);
          }
          return;
        }
        if (event.key === "]") {
          const target = navigationHistory.goForward();
          if (target) {
            event.preventDefault();
            navigateToEntry(target);
          }
          return;
        }
      }
      const command = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
      });
      if (command && handleCommand(command)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.rootWorkspaceId,
    threadSearch,
    api,
    toggleDiffPanel,
    toggleTerminal,
    handleTogglePrimarySidebar,
    navigationHistory,
    navigateToEntry,
  ]);

  useLayoutEffect(() => {
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current =
      lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) ?? true;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState(selectedSessionKey || null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
  }, [selectedSessionKey]);

  useLayoutEffect(() => {
    if (snapshot?.activeView !== "threads" || !selectedSession || activeTranscript.length === 0) {
      return;
    }
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) {
      return;
    }
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    selectedSession,
    selectedSessionKey,
    snapshot?.activeView,
  ]);

  useEffect(() => {
    setTreeModalState((current) =>
      current.open
        ? {
            open: false,
            loading: false,
            submitting: false,
          }
        : current,
    );
  }, [selectedSessionKey, snapshot?.activeView]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (snapshot.activeView === "new-thread" && previousActiveViewRef.current !== "new-thread") {
      // Only set the workspace if it wasn't already set by openNewThreadSurface
      setNewThreadRootWorkspaceId((current) => {
        if (current) {
          return current;
        }
        const nextRootWorkspaceId = resolveRepoWorkspaceId(snapshot.workspaces, selectedWorkspace?.id);
        return nextRootWorkspaceId || current;
      });
    }

    if (snapshot.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      resetExactBottomRestoreState();
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
      if (pinnedToBottomRef.current || preserveBottomOnNextPaneResizeRef.current) {
        preserveBottomOnNextPaneResizeRef.current = true;
        schedulePinnedBottomRealignment(1);
      }
    }

    previousActiveViewRef.current = snapshot.activeView;
  }, [schedulePinnedBottomRealignment, selectedSession, selectedWorkspace?.id, snapshot]);

  useLayoutEffect(() => {
    if (snapshot?.activeView !== "threads" || !selectedSession) {
      return undefined;
    }

    return () => {
      const pane = timelinePaneRef.current;
      if (!pane) {
        return;
      }
      lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
      lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, isNearBottom(pane));
    };
  }, [selectedSession, selectedSessionKey, snapshot?.activeView]);

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession || snapshot?.activeView !== "threads") {
      previousTimelinePaneSizeRef.current = null;
      return undefined;
    }

    const stickToBottomAfterLayoutChange = () => {
      preserveBottomOnNextPaneResizeRef.current = false;
      pinnedToBottomRef.current = true;
      window.requestAnimationFrame(() => {
        requestPinnedBottomAlignment("auto", { preferExactRestore: true });
        window.requestAnimationFrame(() => {
          if (pinnedToBottomRef.current) {
            requestPinnedBottomAlignment("auto", { preferExactRestore: true });
          }
        });
      });
    };

    const updateMeasuredSize = (nextSize: { width: number; height: number }) => {
      const previousSize = previousTimelinePaneSizeRef.current;
      previousTimelinePaneSizeRef.current = nextSize;
      const shouldStickToBottom = preserveBottomOnNextPaneResizeRef.current || pinnedToBottomRef.current;
      const widthChanged = previousSize ? Math.abs(nextSize.width - previousSize.width) >= 1 : false;
      const heightChanged = previousSize ? Math.abs(nextSize.height - previousSize.height) >= 1 : false;
      if (!previousSize || (!widthChanged && !heightChanged) || !shouldStickToBottom) {
        return;
      }

      stickToBottomAfterLayoutChange();
    };

    const paneRect = pane.getBoundingClientRect();
    updateMeasuredSize({ width: paneRect.width, height: paneRect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      updateMeasuredSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [requestPinnedBottomAlignment, selectedSessionKey, showDiffPanel, snapshot?.activeView, timelinePaneMountVersion]);

  useEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || !selectedSession) {
      return;
    }

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
    if (marker === lastTranscriptMarkerRef.current) {
      return;
    }
    lastTranscriptMarkerRef.current = marker;

    if (pinnedToBottomRef.current) {
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      return;
    }

    setShowJumpToLatest(true);
  }, [activeTranscript, requestPinnedBottomAlignment, selectedSession, selectedSessionKey]);

  const handleTimelineContentHeightChange = useCallback(() => {
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
        return;
      }
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
    });
  }, [requestPinnedBottomAlignment]);

  // Click-through from the composer "thread finished" toast.
  // Must be declared before the early return below to preserve hook order.
  const handleSelectSession = (target: { workspaceId: string; sessionId: string }) => {
    // The optimistic placeholder row isn't a real session yet — ignore clicks.
    if (target.sessionId === PENDING_THREAD_SESSION_ID) {
      return;
    }
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
    // Don't double-setSnapshot: the main process already pushes state via
    // onStateChanged inside selectSession (applyFastSessionSelection → emit).
    // Calling setSnapshot again on the IPC return value caused a second full
    // re-render with a structurally-equal-but-fresh object.
    void api?.selectSession(target).then(() => {
      focusComposer();
    });
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenSessionDetail>).detail;
      if (!detail) return;
      handleSelectSession({ workspaceId: detail.workspaceId, sessionId: detail.sessionId });
    };
    window.addEventListener(OPEN_SESSION_EVENT, handler);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, handler);
  }, []);

  if (!api || !snapshot) {
    return (
      <div className="shell shell--loading">
        <main className="loading-card">
          <div className="loading-card__eyebrow">pi-gui</div>
          <h1>Loading sessions</h1>
          <p>The desktop shell is restoring folder and thread state from the main process.</p>
        </main>
      </div>
    );
  }

  const showTerminalTakeover = isTerminalVisibleForSelectedThread && isTerminalTakeoverForSelectedThread && Boolean(selectedWorkspace);
  const mainClassName = [
    "main",
    showDiffPanel ? "main--with-diff" : "",
    isTerminalVisibleForSelectedThread ? "main--with-terminal" : "",
    showTerminalTakeover ? "main--terminal-takeover" : "",
  ].filter(Boolean).join(" ");
  const terminalPanel = isTerminalVisibleForSelectedThread && selectedWorkspace ? (
    <TerminalPanel
      workspace={selectedWorkspace}
      sessionId={selectedSession?.id ?? ""}
      height={terminalHeight}
      isTakeover={isTerminalTakeoverForSelectedThread}
      onHeightChange={(nextHeight) => {
        setTerminalHeight(nextHeight);
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
      }}
      onToggleTakeover={() => {
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : selectedSessionKey));
      }}
      onHide={() => {
        setOpenTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        setTakeoverTerminalSessionKey((current) => (current === selectedSessionKey ? "" : current));
        focusComposer();
      }}
    />
  ) : null;

  const setActiveView = (view: AppView) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView(view));
  };

  const openSkills = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : skillsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setSkillsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("skills");
  };

  const openExtensions = (workspaceId?: string) => {
    const nextWorkspaceId =
      workspaceId && rootWorkspaceOptions.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : extensionsWorkspace?.id || rootWorkspaceOptions[0]?.id || "";
    if (nextWorkspaceId) {
      setExtensionsWorkspaceId(nextWorkspaceId);
    }
    setActiveView("extensions");
  };

  const openNewThreadSurface = (workspaceId?: string) => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadIsChat(false);
    resetNewThreadSurface(workspaceId);
    setActiveView("new-thread");
  };

  const openContext = () => {
    setActiveView("context");
  };

  const setQueueMode = (enabled: boolean) => {
    void updateSnapshot(api, setSnapshot, () => api.setQueueMode(enabled));
  };

  const openNewChatSurface = () => {
    setPendingNewThreadWorkspaceId("");
    setNewThreadIsChat(true);
    setNewThreadEnvironment("local");
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerMode("build");
    setNewThreadComposerError(undefined);
    setActiveView("new-thread");
    focusNewThreadComposer();
  };

  const handleNewThreadAddAttachments = (files: File[]) => {
    void readComposerAttachmentsFromFiles(files).then((attachments) => {
      if (attachments.length === 0) {
        return;
      }
      setNewThreadAttachments((current) => [...current, ...attachments]);
    });
  };

  const handleNewThreadRemoveAttachment = (attachmentId: string) => {
    setNewThreadAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    const files = extractImageFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    onFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>, onFiles: (files: File[]) => void) => {
    event.preventDefault();
    const files = extractFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    onFiles(files);
  };

  const handleNewThreadComposerPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    handleImagePaste(event, handleNewThreadAddAttachments);
  };

  const handleNewThreadComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    handleAttachmentDrop(event, handleNewThreadAddAttachments);
  };

  const handleClipboardImageShortcut = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    onImage: (attachment: ComposerImageAttachment) => void,
  ): boolean => {
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
  };

  function handlePastedClipboardImage(clipboardImage: ComposerImageAttachment) {
    const activeElement = document.activeElement;
    if (activeElement === composerRef.current) {
      if (!api) {
        return;
      }
      void updateSnapshot(api, setSnapshot, () => api.addComposerAttachments([clipboardImage]));
      return;
    }

    if (activeElement === newThreadComposerRef.current) {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    }
  }

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    );
  };

  const handleSetSessionThinking = (level: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleSetDefaultCavemanLevel = (level: CavemanLevel) => {
    setCavemanLevel(level);
    void api.setCavemanDefaultLevel(level);
  };

  const handleSetSessionCavemanLevel = (level: CavemanLevel) => {
    handleSetDefaultCavemanLevel(level);
    if (selectedSession) {
      void updateSnapshot(api, setSnapshot, () => api.submitComposer(`/caveman ${level}`));
    }
  };

  const { loopControl, beginRalphLoop, runRalphLoop } = useRalphLoop(
    snapshot,
    selectedSession,
    selectedWorkspace,
    api,
    setSnapshot,
    updateSnapshot,
    resolvedSessionProvider,
    resolvedSessionModelId,
    resolvedSessionThinkingLevel,
    ralphLaunch,
    setRalphLaunch,
  );

  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultModel(settingsWorkspace.id, provider, modelId));
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel));
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setScopedModelPatterns(settingsWorkspace.id, patterns));
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setModelSettingsScopeMode(mode));
  };

  const handleLoginProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.loginProvider(settingsWorkspace.id, providerId));
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!settingsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.logoutProvider(settingsWorkspace.id, providerId));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey),
    );
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) {
      return "Select a workspace first.";
    }
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.logoutProvider(settingsWorkspace.id, providerId),
    );
    return state.lastError;
  };

  const handleToggleSkill = (filePath: string, enabled: boolean) => {
    if (!skillsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setSkillEnabled(skillsWorkspace.id, filePath, enabled));
  };

  const handleOpenSkillFolder = (filePath: string) => {
    if (!skillsWorkspace) {
      return;
    }
    void api.openSkillInFinder(skillsWorkspace.id, filePath);
  };

  const handleToggleExtension = (filePath: string, enabled: boolean) => {
    if (!extensionsWorkspace) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () => api.setExtensionEnabled(extensionsWorkspace.id, filePath, enabled));
  };

  const handleOpenExtensionFolder = (filePath: string) => {
    if (!extensionsWorkspace) {
      return;
    }
    void api.openExtensionInFinder(extensionsWorkspace.id, filePath);
  };

  const handleDeleteExtension = (filePath: string) => {
    console.log("[deleteExtension] called with:", filePath);
    if (!extensionsWorkspace) {
      console.warn("[deleteExtension] no extensionsWorkspace");
      return;
    }
    if (!api || typeof api.deleteExtension !== "function") {
      console.warn("[deleteExtension] api.deleteExtension not available");
      window.alert("Delete extension is not available. Please restart the app to pick up the latest changes.");
      return;
    }
    console.log("[deleteExtension] api.deleteExtension exists, workspace:", extensionsWorkspace.id);
    const confirmed = window.confirm("Delete this extension? This will permanently remove the extension files from disk.");
    if (!confirmed) {
      console.log("[deleteExtension] user cancelled");
      return;
    }
    console.log("[deleteExtension] confirmed, calling IPC...");
    updateSnapshot(api, setSnapshot, () => {
      console.log("[deleteExtension] invoking api.deleteExtension...");
      return api.deleteExtension(extensionsWorkspace.id, filePath);
    }).then((state) => {
      console.log("[deleteExtension] success, new state:", state.lastError ? "has error: " + state.lastError : "ok");
      const stillThere = state.runtimeByWorkspace[extensionsWorkspace.id]?.extensions?.find((e: { path: string }) => e.path === filePath);
      console.log("[deleteExtension] extension still in runtime?", !!stillThere);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[deleteExtension] FAILED:", message);
      window.alert(`Failed to delete extension: ${message}`);
    });
  };

  const handleTrySkill = (command: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("threads"));
    sessionComposerRef.current?.fillFromSlash(command);
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark" | "dracula") => {
    if (!api) return;
    setThemeMode(mode);
    document.documentElement.classList.toggle("dracula", mode === "dracula");
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleSetSubagentSettings = (settings: Partial<DesktopAppState["subagentSettings"]>) => {
    void updateSnapshot(api, setSnapshot, () => api.setSubagentSettings(settings));
  };

  const handleRefreshSubagentAgents = (workspaceId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.refreshSubagentAgents(workspaceId));
  };

  const handleSaveSubagentAgent = (workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }) => {
    void updateSnapshot(api, setSnapshot, () => api.saveSubagentAgent(workspaceId, input));
  };

  const handleDeleteSubagentAgent = (workspaceId: string, name: string, scope?: "project" | "global") => {
    void updateSnapshot(api, setSnapshot, () => api.deleteSubagentAgent(workspaceId, name, scope));
  };

  const handleChooseExternalTerminalApp = () => {
    void updateSnapshot(api, setSnapshot, () => api.chooseExternalTerminalApp());
  };

  const handleClearExternalTerminalApp = () => {
    void updateSnapshot(api, setSnapshot, () => api.clearExternalTerminalApp());
  };

  const handleRequestNotificationPermission = () => {
    if (!api?.requestNotificationPermission) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .requestNotificationPermission()
      .then((status) => {
        setNotificationPermissionStatus(status);
      })
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleOpenSystemNotificationSettings = () => {
    if (!api?.openSystemNotificationSettings) {
      return;
    }
    setNotificationPermissionPending(true);
    void api
      .openSystemNotificationSettings()
      .finally(() => {
        setNotificationPermissionPending(false);
      });
  };

  const handleArchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    // Optimistically guard the row out of the active list immediately; the
    // guard is dropped once the backend snapshot confirms the archive.
    setRecentlyDone((prev) => {
      const next = new Set(prev);
      next.add(doneSessionKey(target.workspaceId, target.sessionId));
      return next;
    });
    void updateSnapshot(api, setSnapshot, () => api.archiveSession(target));
  };

  const handleArchiveAllNonRunningSessions = (workspaceId: string, olderThanMs?: number) => {
    void updateSnapshot(api, setSnapshot, () => api.archiveAllNonRunningSessions(workspaceId, olderThanMs));
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly answers: readonly { readonly id: string; readonly value: string; readonly label: string; readonly wasCustom: boolean; readonly index?: number }[] }
      | { readonly requestId: string; readonly cancelled: true },
  ) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }

    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, response),
    ).then(() => {
      focusComposer();
    });
  };

  const handleUnarchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unarchiveSession(target));
  };

  const handleCreateChat = () => {
    openNewChatSurface();
  };

  const handleSelectChat = (chatId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.selectChat(chatId)).then(() => {
      focusComposer();
    });
  };

  const handleArchiveChat = (chatId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.archiveChat(chatId));
  };

  const handleUnarchiveChat = (chatId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.unarchiveChat(chatId));
  };

  const handleRemoveChat = (chatId: string) => {
    void updateSnapshot(api, setSnapshot, () => api.removeChat(chatId));
  };

  const handleStartChat = (promptOverride?: string) => {
    const submittedPrompt = promptOverride ?? newThreadPrompt;
    if (!submittedPrompt.trim() && newThreadAttachments.length === 0) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(submittedPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    const input: StartChatInput = {
      prompt: newThreadComposerMode === "plan" ? buildPlanModePrompt(submittedPrompt) : submittedPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
    };
    const capturedPrompt = submittedPrompt;
    const capturedAttachments = newThreadAttachments;
    composerFlipFromRef.current =
      document.querySelector(".new-thread__composer")?.getBoundingClientRect() ?? null;
    heroFlipFromRef.current = captureHeroFlip();
    setPendingThreadStart({
      rootWorkspaceId: "",
      title: deriveThreadTitle(capturedPrompt),
      createdAt: new Date().toISOString(),
      prompt: capturedPrompt,
      attachments: capturedAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
      cavemanLevel,
      composerMode: newThreadComposerMode,
    });
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerMode("build");
    setNewThreadIsChat(false);
    void updateSnapshot(api, setSnapshot, () => api.startChat(input))
      .then((state) => {
        // Don't clear the placeholder yet — hold it until the new session's
        // transcript arrives so the live view doesn't flash an empty/loading
        // state. The hold effect clears pendingThreadStart once ready.
        setPendingThreadStart((prev) =>
          prev
            ? { ...prev, sessionId: state.selectedSessionId, workspaceId: state.selectedWorkspaceId }
            : prev,
        );
      })
      .catch((error: unknown) => {
        setPendingThreadStart(null);
        setNewThreadIsChat(true);
        setNewThreadPrompt(capturedPrompt);
        setNewThreadAttachments(capturedAttachments);
        setNewThreadComposerError(
          error instanceof Error ? error.message : "Failed to start chat.",
        );
      });
  };

  const handleStartThread = (promptOverride?: string) => {
    const submittedPrompt = promptOverride ?? newThreadPrompt;
    if (newThreadIsChat) {
      handleStartChat(submittedPrompt);
      return;
    }
    if (!newThreadRootWorkspaceId || (!submittedPrompt.trim() && newThreadAttachments.length === 0)) {
      return;
    }
    if (newThreadModelOnboarding.requiresModelSelection) {
      return;
    }
    const treeCommand = parseTreeComposerCommand(submittedPrompt);
    if (treeCommand?.type === "error") {
      setNewThreadComposerError(treeCommand.message);
      return;
    }
    if (treeCommand?.type === "tree") {
      setNewThreadComposerError("/tree is only available inside an existing session.");
      return;
    }
    const modelConfig = {
      prompt: newThreadComposerMode === "plan" ? buildPlanModePrompt(submittedPrompt) : submittedPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
    };
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadEnvironment,
      ...modelConfig,
    };
    wsMenu.expandWorkspace(newThreadRootWorkspaceId);
    // Capture a snapshot of what the user just sent so we can render an
    // immediate placeholder session view while the main process spins up
    // the runtime. We clear the composer state up front (rather than in
    // the .then) so the new-thread surface won't briefly reappear with
    // stale text if startThread resolves slowly.
    composerFlipFromRef.current =
      document.querySelector(".new-thread__composer")?.getBoundingClientRect() ?? null;
    heroFlipFromRef.current = captureHeroFlip();
    setPendingThreadStart({
      rootWorkspaceId: newThreadRootWorkspaceId,
      title: deriveThreadTitle(submittedPrompt),
      priorSelectedSessionId: snapshot?.selectedSessionId,
      createdAt: new Date().toISOString(),
      prompt: submittedPrompt,
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
      cavemanLevel,
      composerMode: newThreadComposerMode,
    });
    setNewThreadPrompt("");
    setNewThreadAttachments([]);
    setNewThreadProvider(undefined);
    setNewThreadModelId(undefined);
    setNewThreadThinkingLevel(undefined);
    setNewThreadComposerMode("build");
    setNewThreadEnvironment("local");
    void updateSnapshot(api, setSnapshot, () =>
      api.startThread(input),
    ).then((state) => {
      // Hold the placeholder until the new session's transcript arrives (see
      // the hold effect) so going live is a seamless label swap rather than a
      // flash through an empty/loading transcript.
      setPendingThreadStart((prev) =>
        prev
          ? { ...prev, sessionId: state.selectedSessionId, workspaceId: state.selectedWorkspaceId }
          : prev,
      );
      // Keep showing the prompt title until the auto-generated one resolves.
      if (state.selectedSessionId) {
        setNewThreadTitleFallback((prev) => ({
          ...prev,
          [state.selectedSessionId]: deriveThreadTitle(submittedPrompt),
        }));
      }
    }).catch((error: unknown) => {
      // startThread can reject if the main process fails to register/handle
      // the IPC (e.g. a runtime spin-up error). Without this the pending
      // "Preparing your thread…" view would hang forever with no feedback.
      // Clear the placeholder, restore the composer input, and surface the error.
      setPendingThreadStart(null);
      setNewThreadPrompt(submittedPrompt);
      setNewThreadAttachments(newThreadAttachments);
      setNewThreadComposerError(
        error instanceof Error ? error.message : "Failed to start thread.",
      );
    });
  };

  const handleTimelineScroll = () => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return;
    }

    const pinned = isNearBottom(pane);
    if (preserveBottomOnNextPaneResizeRef.current && !pinned) {
      return;
    }

    pinnedToBottomRef.current = pinned;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      setShowJumpToLatest(false);
    }
  };

  const jumpToLatest = () => {
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  };

  const handleNewThreadComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleClipboardImageShortcut(event, (clipboardImage) => {
      setNewThreadAttachments((current) => [...current, clipboardImage]);
    })) {
      return;
    }

    if (newThreadMentionMenu.handleMentionKeyDown(event)) {
      return;
    }

    if (newThreadSlashMenu.handleSlashKeyDown(event)) {
      return;
    }

    return;
  };

  if (snapshot.activeView === "settings") {
    const settingsShellClass = `shell shell--skills${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
    const settingsShellStyle = snapshot.sidebarCollapsed
      ? undefined
      : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);
    return (
      <div className={settingsShellClass} style={settingsShellStyle} data-testid="settings-surface">
        {primarySidebarToggleVisible ? (
          <SidebarToggleButton
            collapsed={snapshot.sidebarCollapsed}
            shortcutLabel={sidebarToggleShortcutLabel}
            onToggle={handleTogglePrimarySidebar}
          />
        ) : null}
        {!snapshot.sidebarCollapsed ? (
          <Sidebar
            resize={sidebarResize}
            activeView={snapshot.activeView}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            chats={chats}
            visibleWorkspaces={visibleWorkspaces}
            threadGroups={threadGroups}
            linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
            wsMenu={wsMenu}
            api={api}
            setSnapshot={setSnapshot}
            updateSnapshot={updateSnapshot}
            onNewThreadForWorkspace={(rootWorkspaceId) => openNewThreadSurface(rootWorkspaceId)}
            onSetActiveView={setActiveView}
            onOpenSkills={openSkills}
            onOpenExtensions={openExtensions}
            onOpenSettings={openSettings}
            onOpenContext={openContext}
            queueMode={snapshot.queueMode}
            onSetQueueMode={setQueueMode}
            onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
            onSelectSession={handleSelectSession}
            onUnarchiveSession={handleUnarchiveSession}
            onCreateChat={handleCreateChat}
            onSelectChat={handleSelectChat}
            onArchiveChat={handleArchiveChat}
            onUnarchiveChat={handleUnarchiveChat}
            onRemoveChat={handleRemoveChat}
          />
        ) : null}
        <main className="main main--skills">
          {settingsSection === "providers" || (settingsSection === "models" && snapshot.modelSettingsScopeMode === "per-repo") ? (
            <div className="surface-toolbar">

              <label className="surface-toolbar__field">
                <span>Workspace</span>
                <select
                  value={settingsWorkspace?.id ?? ""}
                  onChange={(event) => setSettingsWorkspaceId(event.target.value)}
                >
                  {rootWorkspaceOptions.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <SettingsView
            workspace={settingsWorkspace}
            runtime={settingsSection === "models" ? settingsModelRuntime : settingsRuntime}
            section={settingsSection}
            onSelectSection={setSettingsSection}
            onBack={() => setActiveView("threads")}
            notificationPreferences={snapshot.notificationPreferences}
            notificationPermissionStatus={notificationPermissionStatus}
            notificationPermissionPending={notificationPermissionPending}
            modelSettingsScopeMode={snapshot.modelSettingsScopeMode}
            integratedTerminalShell={snapshot.integratedTerminalShell}
            externalTerminalApp={snapshot.externalTerminalApp}
            themeMode={themeMode}
            enableTransparency={snapshot.enableTransparency}
            transcriptVerbose={snapshot.transcriptVerbose}
            composerDeviceMode={snapshot.composerDeviceMode}
            threadTransition={snapshot.threadTransition}
            buttonSoundSettings={buttonSoundSettings}
            subagentSettings={snapshot.subagentSettings}
            retrySettings={snapshot.retrySettings}
            onSetRetrySettings={(settings) => {
              void updateSnapshot(api, setSnapshot, () => api.setRetrySettings(settings));
            }}
            subagentAgents={settingsWorkspace ? snapshot.subagentAgentsByWorkspace[settingsWorkspace.id] ?? [] : []}
            onLoginProvider={handleLoginProvider}
            onLogoutProvider={handleLogoutProvider}
            onSetProviderApiKey={handleSetProviderApiKey}
            onRemoveProviderApiKey={handleRemoveProviderApiKey}
            onSetModelSettingsScopeMode={handleSetModelSettingsScopeMode}
            onSetDefaultModel={handleSetDefaultModel}
            onSetNotificationPreferences={handleSetNotificationPreferences}
            onSetIntegratedTerminalShell={handleSetIntegratedTerminalShell}
            onSetSubagentSettings={handleSetSubagentSettings}
            onRefreshSubagentAgents={handleRefreshSubagentAgents}
            onSaveSubagentAgent={handleSaveSubagentAgent}
            onDeleteSubagentAgent={handleDeleteSubagentAgent}
            onChooseExternalTerminalApp={handleChooseExternalTerminalApp}
            onClearExternalTerminalApp={handleClearExternalTerminalApp}
            onRequestNotificationPermission={handleRequestNotificationPermission}
            onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
            onSetScopedModelPatterns={handleSetScopedModelPatterns}
            onSetThemeMode={handleSetThemeMode}
            onSetThinkingLevel={handleSetThinkingLevel}
            onToggleSkillCommands={handleToggleSkillCommands}
            onSetEnableTransparency={(enabled) => {
              void updateSnapshot(api, setSnapshot, () => api.setEnableTransparency(enabled));
            }}
            onSetTranscriptVerbose={(enabled) => {
              void updateSnapshot(api, setSnapshot, () => api.setTranscriptVerbose(enabled));
            }}
            onSetComposerDeviceMode={(enabled) => {
              void updateSnapshot(api, setSnapshot, () => api.setComposerDeviceMode(enabled));
            }}
            onSetThreadTransition={(settings) => {
              void updateSnapshot(api, setSnapshot, () => api.setThreadTransition(settings));
            }}
            onSetButtonSoundSettings={setButtonSoundSettings}
            commitPushModel={snapshot.commitPushModel}
            onSetCommitPushModel={(model) => {
              void updateSnapshot(api, setSnapshot, () => api.setCommitPushModel(rootWorkspace?.id ?? "", model));
            }}
          />
        </main>
        {import.meta.env.DEV && <Agentation />}
      </div>
    );
  }

  if (snapshot.activeView === "skills") {
    const handleToggleSkillGroup = (key: string) => {
      setSkillsCollapsedGroups((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    };
    const skillsShellClass = `shell shell--skills${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
    const skillsShellStyle = snapshot.sidebarCollapsed
      ? undefined
      : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);
    return (
      <div className={skillsShellClass} style={skillsShellStyle} data-testid="skills-surface">
        {primarySidebarToggleVisible ? (
          <SidebarToggleButton
            collapsed={snapshot.sidebarCollapsed}
            shortcutLabel={sidebarToggleShortcutLabel}
            onToggle={handleTogglePrimarySidebar}
          />
        ) : null}
        {!snapshot.sidebarCollapsed ? (
          <Sidebar
            resize={sidebarResize}
            activeView={snapshot.activeView}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            chats={chats}
            visibleWorkspaces={visibleWorkspaces}
            threadGroups={threadGroups}
            linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
            wsMenu={wsMenu}
            api={api}
            setSnapshot={setSnapshot}
            updateSnapshot={updateSnapshot}
            onNewThreadForWorkspace={(rootWorkspaceId) => openNewThreadSurface(rootWorkspaceId)}
            onSetActiveView={setActiveView}
            onOpenSkills={openSkills}
            onOpenExtensions={openExtensions}
            onOpenSettings={openSettings}
            onOpenContext={openContext}
            queueMode={snapshot.queueMode}
            onSetQueueMode={setQueueMode}
            onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
            onSelectSession={handleSelectSession}
            onUnarchiveSession={handleUnarchiveSession}
            onCreateChat={handleCreateChat}
            onSelectChat={handleSelectChat}
            onArchiveChat={handleArchiveChat}
            onUnarchiveChat={handleUnarchiveChat}
            onRemoveChat={handleRemoveChat}
          />
        ) : null}
        <main className="main main--skills">
          {rootWorkspaceOptions.length > 1 ? (
            <div className="surface-toolbar">
              <label className="surface-toolbar__field">
                <span>Workspace</span>
                <select
                  value={skillsWorkspace?.id ?? ""}
                  onChange={(event) => setSkillsWorkspaceId(event.target.value)}
                >
                  {rootWorkspaceOptions.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <SkillsView
            workspace={skillsWorkspace}
            runtime={skillsRuntime}
            query={skillsQuery}
            onQueryChange={setSkillsQuery}
            showDisabled={skillsShowDisabled}
            onShowDisabledChange={setSkillsShowDisabled}
            collapsedGroups={skillsCollapsedGroups}
            onToggleGroup={handleToggleSkillGroup}
            selectedSkillPath={skillsSelectedPath}
            onSelectSkill={setSkillsSelectedPath}
            onOpenSkillFolder={handleOpenSkillFolder}
            onRefresh={() => {
              if (!skillsWorkspace) {
                return;
              }
              void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(skillsWorkspace.id));
            }}
            onToggleSkill={handleToggleSkill}
            onTrySkill={(skill) =>
              handleTrySkill(
                skill.filePath
                  ? `${skill.slashCommand} `
                  : "Create a new skill for this workspace and explain which files you will add.",
              )
            }
          />
        </main>
        {import.meta.env.DEV && <Agentation />}
      </div>
    );
  }

  if (snapshot.activeView === "extensions") {
    const extensionsShellClass = `shell shell--skills${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
    const extensionsShellStyle = snapshot.sidebarCollapsed
      ? undefined
      : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);
    return (
      <div className={extensionsShellClass} style={extensionsShellStyle} data-testid="extensions-surface">
        {primarySidebarToggleVisible ? (
          <SidebarToggleButton
            collapsed={snapshot.sidebarCollapsed}
            shortcutLabel={sidebarToggleShortcutLabel}
            onToggle={handleTogglePrimarySidebar}
          />
        ) : null}
        {!snapshot.sidebarCollapsed ? (
          <Sidebar
            resize={sidebarResize}
            activeView={snapshot.activeView}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            chats={chats}
            visibleWorkspaces={visibleWorkspaces}
            threadGroups={threadGroups}
            linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
            wsMenu={wsMenu}
            api={api}
            setSnapshot={setSnapshot}
            updateSnapshot={updateSnapshot}
            onNewThreadForWorkspace={(rootWorkspaceId) => openNewThreadSurface(rootWorkspaceId)}
            onSetActiveView={setActiveView}
            onOpenSkills={openSkills}
            onOpenExtensions={openExtensions}
            onOpenSettings={openSettings}
            onOpenContext={openContext}
            queueMode={snapshot.queueMode}
            onSetQueueMode={setQueueMode}
            onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
            onSelectSession={handleSelectSession}
            onUnarchiveSession={handleUnarchiveSession}
            onCreateChat={handleCreateChat}
            onSelectChat={handleSelectChat}
            onArchiveChat={handleArchiveChat}
            onUnarchiveChat={handleUnarchiveChat}
            onRemoveChat={handleRemoveChat}
          />
        ) : null}
        <main className="main main--skills">
          <ExtensionsView
            workspace={extensionsWorkspace}
            runtime={extensionsRuntime}
            commandCompatibility={extensionsCommandCompatibility}
            onOpenExtensionFolder={handleOpenExtensionFolder}
            onRefresh={() => {
              if (!extensionsWorkspace) {
                return;
              }
              void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(extensionsWorkspace.id));
            }}
            onToggleExtension={handleToggleExtension}
            onDeleteExtension={handleDeleteExtension}
          />
        </main>
        {import.meta.env.DEV && <Agentation />}
      </div>
    );
  }

  if (snapshot.activeView === "context") {
    const contextShellClass = `shell shell--skills${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
    const contextShellStyle = snapshot.sidebarCollapsed
      ? undefined
      : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);
    return (
      <div className={contextShellClass} style={contextShellStyle} data-testid="context-surface">
        {primarySidebarToggleVisible ? (
          <SidebarToggleButton
            collapsed={snapshot.sidebarCollapsed}
            shortcutLabel={sidebarToggleShortcutLabel}
            onToggle={handleTogglePrimarySidebar}
          />
        ) : null}
        {!snapshot.sidebarCollapsed ? (
          <Sidebar
            resize={sidebarResize}
            activeView={snapshot.activeView}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            chats={chats}
            visibleWorkspaces={visibleWorkspaces}
            threadGroups={threadGroups}
            linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
            wsMenu={wsMenu}
            api={api}
            setSnapshot={setSnapshot}
            updateSnapshot={updateSnapshot}
            onNewThreadForWorkspace={(rootWorkspaceId) => openNewThreadSurface(rootWorkspaceId)}
            onSetActiveView={setActiveView}
            onOpenSkills={openSkills}
            onOpenExtensions={openExtensions}
            onOpenSettings={openSettings}
            onOpenContext={openContext}
            queueMode={snapshot.queueMode}
            onSetQueueMode={setQueueMode}
            onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
            onSelectSession={handleSelectSession}
            onUnarchiveSession={handleUnarchiveSession}
            onCreateChat={handleCreateChat}
            onSelectChat={handleSelectChat}
            onArchiveChat={handleArchiveChat}
            onUnarchiveChat={handleUnarchiveChat}
            onRemoveChat={handleRemoveChat}
          />
        ) : null}
        <main className="main main--skills">
          <ContextView
            workspace={contextWorkspace}
            runtime={contextRuntime}
            snapshot={contextSnapshot}
            loading={contextLoading}
            onRefresh={loadContextSnapshot}
            api={api}
          />
        </main>
        {import.meta.env.DEV && <Agentation />}
      </div>
    );
  }

  const shellClassName = `shell${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
  const shellStyle = snapshot.sidebarCollapsed
    ? undefined
    : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);

  return (
    <div className={shellClassName} style={shellStyle}>
      {primarySidebarToggleVisible ? (
        <SidebarToggleButton
          collapsed={snapshot.sidebarCollapsed}
          shortcutLabel={sidebarToggleShortcutLabel}
          onToggle={handleTogglePrimarySidebar}
        />
      ) : null}
      {!snapshot.sidebarCollapsed ? (
        <Sidebar
          resize={sidebarResize}
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          chats={chats}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onNewThreadForWorkspace={(rootWorkspaceId) => openNewThreadSurface(rootWorkspaceId)}
          onSetActiveView={setActiveView}
          onOpenSkills={openSkills}
          onOpenExtensions={openExtensions}
          onOpenSettings={openSettings}
          onOpenContext={openContext}
            queueMode={snapshot.queueMode}
            onSetQueueMode={setQueueMode}
          onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
          onSelectSession={handleSelectSession}
          onUnarchiveSession={handleUnarchiveSession}
          onCreateChat={handleCreateChat}
          onSelectChat={handleSelectChat}
          onArchiveChat={handleArchiveChat}
          onUnarchiveChat={handleUnarchiveChat}
          onRemoveChat={handleRemoveChat}
        />
      ) : null}

      <main className={mainClassName}>
        <Topbar
          activeView={snapshot.activeView}
          rootWorkspace={rootWorkspace}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
          selectedWorktree={selectedWorktree}
          activeWorktrees={activeWorktrees}
          workspaces={snapshot.workspaces}
          wsMenu={wsMenu}
          api={api}
          terminalAvailable={Boolean(selectedSessionKey)}
          terminalVisible={isTerminalVisibleForSelectedThread}
          onToggleTerminal={toggleTerminal}
          externalTerminalAvailable={Boolean(selectedSessionKey) && selectedSession?.status !== "running"}
          onOpenExternalTerminal={openExternalTerminal}
          showDiffPanel={showDiffPanel}
          onToggleDiffPanel={toggleDiffPanel}
          selectedRuntime={rootRuntime}
          commitPushModel={snapshot.commitPushModel}
        />

        {showTerminalTakeover ? (
          terminalPanel
        ) : (
          <>
        {snapshot.activeView === "new-thread" && !pendingThreadStart ? (
          newThreadIsChat || rootWorkspaceOptions.length > 0 ? (
            <NewThreadView
              isChat={newThreadIsChat}
              workspaces={rootWorkspaceOptions}
              selectedWorkspaceId={newThreadRootWorkspaceId || rootWorkspaceOptions[0]?.id || ""}
              runtime={newThreadRuntime}
              environment={newThreadEnvironment}
              prompt={newThreadPrompt}
              attachments={newThreadAttachments}
              lastError={newThreadComposerError}
              provider={resolvedNewThreadProvider}
              modelId={resolvedNewThreadModelId}
              thinkingLevel={resolvedNewThreadThinkingLevel}
              cavemanLevel={cavemanLevel}
              composerMode={newThreadComposerMode}
              modelOnboarding={newThreadModelOnboarding}
              modelSelectorRef={modelSelectorRef}
              composerRef={newThreadComposerRef}
              activeSlashCommand={newThreadSlashMenu.activeSlashFlow?.command}
              activeSlashCommandMeta={newThreadSlashMenu.activeSlashFlow?.command?.description}
              slashSections={newThreadSlashMenu.slashSections}
              slashOptions={newThreadSlashMenu.slashOptions}
              selectedSlashCommand={newThreadSlashMenu.activeSlashOptionCommand ?? newThreadSlashMenu.selectedSlashCommand}
              selectedSlashOption={newThreadSlashMenu.selectedSlashOption}
              showSlashMenu={newThreadSlashMenu.showSlashMenu}
              showSlashOptionMenu={newThreadSlashMenu.showSlashOptionMenu}
              slashOptionEmptyState={newThreadSlashMenu.slashOptionEmptyState}
              showMentionMenu={newThreadMentionMenu.showMentionMenu}
              mentionOptions={newThreadMentionMenu.mentionOptions}
              selectedMentionIndex={newThreadMentionMenu.selectedIndex}
              onChangePrompt={setNewThreadPrompt}
              onSelectEnvironment={setNewThreadEnvironment}
              onSetModel={(provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); }}
              onSetThinking={setNewThreadThinkingLevel}
              onSetCavemanLevel={handleSetDefaultCavemanLevel}
              onSetComposerMode={setNewThreadComposerMode}
              onOpenModelSettings={(section) => openSettings(newThreadWorkspace?.id, section)}
              onComposerKeyDown={handleNewThreadComposerKeyDown}
              onComposerPaste={handleNewThreadComposerPaste}
              onComposerDrop={handleNewThreadComposerDrop}
              onClearSlashCommand={newThreadSlashMenu.resetSlashUi}
              onSelectSlashCommand={(command) => {
                newThreadSlashMenu.applySlashCommandSelection(command, "click");
              }}
              onSelectSlashOption={(option) => {
                newThreadSlashMenu.applySlashOptionSelection(option);
              }}
              onSelectMention={newThreadMentionMenu.insertMention}
              onRemoveAttachment={handleNewThreadRemoveAttachment}
              onSubmit={handleStartThread}
            />
          ) : (
            <section className="canvas canvas--empty">
              <div className="empty-panel">
                <div className="session-header__eyebrow">Workspace</div>
                <h1>Open a folder to start</h1>
                <p>Add a project folder before creating a new thread.</p>
              </div>
            </section>
          )
        ) : pendingThreadStart || (selectedWorkspace && selectedSession) ? (
          <>
            <section className="canvas canvas--thread">
              <LoadingBar loading={pendingThreadStart ? false : isTranscriptLoading} />
              <div className="conversation conversation--thread">
                <SubagentLiveProvider widgets={selectedExtensionUi?.widgets ?? []}>
                <ConversationTimeline
                  transcript={threadViewTranscript}
                  isTranscriptLoading={pendingThreadStart ? false : isTranscriptLoading}
                  timelinePaneRef={timelinePaneRef}
                  timelinePaneElementRef={setTimelinePaneElement}
                  disableVirtualization={disableTimelineVirtualization}
                  onDisableVirtualizationReady={finalizeTimelineVirtualizationDisable}
                  onTimelineScroll={handleTimelineScroll}
                  threadSearch={threadSearch}
                  showJumpToLatest={showJumpToLatest}
                  onJumpToLatest={jumpToLatest}
                  onContentHeightChange={handleTimelineContentHeightChange}
                  onViewFileInDiff={handleViewFileInDiff}
                  onUndoEdits={handleUndoEdits}
                  onRedoEdits={handleRedoEdits}
                  isRunning={threadViewIsRunning}
                  workingLabel={pendingThreadStart ? "Preparing your thread…" : undefined}
                />
                </SubagentLiveProvider>
              </div>
            </section>
            {selectedWorkspace && selectedSession ? (
            <SessionComposer
              ref={sessionComposerRef}
              api={api}
              setSnapshot={setSnapshot}
              updateSnapshot={updateSnapshot}
              selectedSession={selectedSession}
              selectedWorkspace={selectedWorkspace}
              selectedSessionKey={selectedSessionKey}
              selectedRuntime={selectedRuntime}
              selectedModelRuntime={selectedModelRuntime}
              resolvedSessionProvider={resolvedSessionProvider}
              resolvedSessionModelId={resolvedSessionModelId}
              resolvedSessionThinkingLevel={resolvedSessionThinkingLevel}
              modelOnboarding={selectedSessionModelOnboarding}
              selectedSessionCommands={selectedSessionCommands}
              selectedWorkspaceCommandCompatibility={selectedWorkspaceCommandCompatibility}
              blackholeAvailable={blackholeAvailable}
              snapshotComposerAttachments={snapshotComposerAttachments}
              queuedMessages={queuedComposerMessages}
              editingQueuedMessageId={editingQueuedMessageId}
              cavemanLevel={cavemanLevel}
              runningLabel={runningLabel}
              loopControl={loopControl}
              beginRalphLoop={beginRalphLoop}
              lastError={composerLastError}
              hasSnapshot={Boolean(snapshot)}
              persistedComposerDraft={persistedComposerDraft}
              composerDraftSyncNonce={snapshot?.composerDraftSyncNonce ?? 0}
              composerDraftSyncSource={snapshot?.composerDraftSyncSource}
              composerRef={composerRef}
              modelSelectorRef={modelSelectorRef}
              timelinePaneRef={timelinePaneRef}
              pinnedToBottomRef={pinnedToBottomRef}
              preserveBottomOnNextPaneResizeRef={preserveBottomOnNextPaneResizeRef}
              requestPinnedBottomAlignment={requestPinnedBottomAlignment}
              focusComposer={focusComposer}
              openTreeModal={openTreeModal}
              openSettings={openSettings}
              onSetModel={handleSetSessionModel}
              onSetThinking={handleSetSessionThinking}
              onSetCavemanLevel={handleSetSessionCavemanLevel}
              onOpenModelSettings={(section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
              }
              handleClipboardImageShortcut={handleClipboardImageShortcut}
              questionnaireRequest={activeQuestionnaireRequest}
              onRespondToQuestionnaire={handleRespondToExtensionDialog}
            />
            ) : (
              <PendingComposer
                runtime={rootRuntime}
                provider={pendingThreadStart?.provider}
                modelId={pendingThreadStart?.modelId}
                thinkingLevel={pendingThreadStart?.thinkingLevel}
                cavemanLevel={pendingThreadStart?.cavemanLevel ?? cavemanLevel}
                composerMode={pendingThreadStart?.composerMode ?? "build"}
              />
            )}
            {activeExtensionDialog ? (
              <ExtensionDialog dialog={activeExtensionDialog} onRespond={handleRespondToExtensionDialog} />
            ) : null}
            {ralphLaunch ? (
              <RalphLaunchDialog
                planTitle={ralphLaunch.plan.title}
                runtime={selectedModelRuntime}
                provider={ralphLaunch.provider}
                modelId={ralphLaunch.modelId}
                thinkingLevel={ralphLaunch.thinkingLevel}
                maxIterations={ralphLaunch.maxIterations}
                onSetModel={(provider, modelId) =>
                  setRalphLaunch((prev) => (prev ? { ...prev, provider, modelId } : prev))
                }
                onSetThinking={(thinkingLevel) =>
                  setRalphLaunch((prev) => (prev ? { ...prev, thinkingLevel } : prev))
                }
                onSetMaxIterations={(maxIterations) =>
                  setRalphLaunch((prev) => (prev ? { ...prev, maxIterations } : prev))
                }
                onCancel={() => setRalphLaunch(null)}
                onRun={runRalphLoop}
              />
            ) : null}
            {treeModalState.open ? (
              <TreeModal
                error={treeModalState.error}
                loading={treeModalState.loading}
                submitting={treeModalState.submitting}
                tree={treeModalState.tree}
                onClose={closeTreeModal}
                onNavigate={navigateTreeSelection}
              />
            ) : null}
          </>
        ) : selectedWorkspace ? (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>{selectedWorkspace.name}</h1>
              <p>Create a thread for this folder, then jump between sessions from the sidebar.</p>
              <div className="empty-panel__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => { playButtonClick(); openNewThreadSurface(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
                >
                  New thread
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="canvas canvas--empty">
            <div className="empty-panel">
              <div className="session-header__eyebrow">Workspace</div>
              <h1>Open a folder to start</h1>
              <p>Add project folders, group sessions under them, and jump between threads from the sidebar.</p>
            </div>
          </section>
        )}

        {terminalPanel}
          </>
        )}
        {showDiffPanel && selectedWorkspace && selectedSession ? (
          <DiffPanel
            workspaceId={selectedWorkspace.id}
            sessionId={selectedSession.id}
            api={api}
            sessionStatus={selectedSession.status}
            fileRequest={diffFileRequest}
            refreshNonce={diffRefreshNonce}
          />
        ) : null}
      </main>
      <ImageLightbox />
      <ToastHost />
      {import.meta.env.DEV && <Agentation />}
    </div>
  );
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  return `${sessionKey}:${transcript.length}:${lastItem ? JSON.stringify(lastItem) : ""}`;
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}

function isRequestAbortedError(message: string | undefined): boolean {
  return Boolean(message && /\brequest\s+(?:was\s+)?aborted\b/i.test(message));
}
