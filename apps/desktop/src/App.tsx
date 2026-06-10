import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type SetStateAction } from "react";
import type { SessionTreeSnapshot } from "@pi-gui/session-driver/types";

import {
  getSelectedSession,
  getSelectedWorkspace,
  type AppView,
  type ComposerImageAttachment,
  type ContextSnapshot,
  type DesktopAppState,
  type SelectedTranscriptRecord,
  type SessionStatus,
  type StartChatInput,
  type StartThreadInput,
  STREAM_REVEAL_FX_TOKENS,
  type TranscriptMessage,
  type WorktreeRecord,
  type WorkspaceRecord,
  ZOOM_BASELINE,
  zoomFactorToPercent,
} from "./desktop-state";
import { SessionComposer, type SessionComposerHandle } from "./session-composer";
import { composeOutgoingPrompt, type ComposerMode } from "./composer-mode";
import { DiffPanel, type DiffPanelFileRequest } from "./diff-panel";
import { AdvisorPanel } from "./advisor-panel";
import { SubagentSessionPanel, SubagentSessionOpenProvider } from "./subagent-session-panel";
import {
  reduceAdvisorState,
  getAdvisorSideEffect,
  createEmptyAdvisorState,
  type AdvisorIntent,
} from "./advisor-handoff-controller";
import { buildModelOptions } from "./composer-commands";
import { parseTreeComposerCommand } from "./composer-commands";
import {
  getDesktopShortcutLabel,
  type DesktopNotificationPermissionStatus,
  type CavemanLevel,
  type UndoEditOp,
} from "./ipc";
import type { ChassisAction } from "./chassis";
import { toggleStickyActivation } from "./chassis";
import { deriveModelOnboardingState } from "./model-onboarding";
import { getDefaultLayout } from "./composer-layout";
import { type ModelSelectorHandle } from "./model-selector";
import { UtilitySurface, SettingsSurface, SkillsSurface, ExtensionsSurface, AutomationsSurface, ContextSurface, AgentsSurface, TestingSurface, ComposerLayoutSurface } from "./surfaces/utility-surface";
import { GraphSurface } from "./surfaces/graph-surface";
import { type SettingsSection } from "./settings-view";
import { NewThreadView } from "./new-thread-view";
import { KanbanView } from "./kanban-view";
import { PendingComposer } from "./pending-thread-view";
import { buildThreadGroups, PENDING_THREAD_SESSION_ID, type ThreadListEntry } from "./thread-groups";
import { usePendingThreadGoLive, captureHeroFlip } from "./hooks/use-pending-thread-go-live";
import { Sidebar } from "./sidebar";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { playButtonClick, preloadSounds, DEFAULT_BUTTON_SOUND_SETTINGS, type ButtonSoundSettings } from "./button-click-sound";
import { Topbar } from "./topbar";
import { EnvironmentPanel } from "./environment-widget";
import { TerminalPanel } from "./terminal-panel";
import { ConversationTimeline } from "./conversation-timeline";
import LoadingBar from "./loading-bar";
import { useSlashMenu } from "./hooks/use-slash-menu";
import { useMentionMenu } from "./hooks/use-mention-menu";
import { useThreadSearch } from "./hooks/use-thread-search";
import { useGlobalSearch } from "./hooks/use-global-search";
import type { GlobalSearchResult } from "./hooks/use-global-search";
import { SearchPalette } from "./search-palette";
import { useWorkspaceMenu } from "./hooks/use-workspace-menu";
import { useTimelineScroll } from "./hooks/use-timeline-scroll";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import type { SidebarNavEntry } from "./hooks/build-sidebar-nav-list";
import { useSettingsHandlers } from "./hooks/use-settings-handlers";
import { useSkillsExtensionsHandlers } from "./hooks/use-skills-extensions";
import { useNavigationHistory } from "./hooks/use-navigation-history";
import { useNewThreadState } from "./hooks/use-new-thread-state";

import { useSelfHealTranscript } from "./hooks/use-self-heal-transcript";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { ExtensionDialog } from "./extension-session-ui";
import { TerminalCustomOverlay } from "./terminal-custom-overlay";
import { SubagentLiveProvider } from "./subagent-live";
import { SubagentTimelineProvider } from "./subagent-timeline";
import { FLEET_WIDGET_KEY, parseFleet } from "./subagent-fleet";
import { TreeModal } from "./tree-modal";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { ImageLightbox } from "./image-lightbox";
import { Agentation } from "agentation";
import { showToast } from "./toast";
import { notifyThreadComplete, OPEN_SESSION_EVENT, type OpenSessionDetail } from "./composer-completion-toast";
import { getEffectiveModelRuntime } from "./model-settings";
import { resolveRepoWorkspaceId } from "./workspace-roots";
import {
  extractImageFilesFromClipboardData,
  extractFilesFromDataTransfer,
} from "./composer-attachments";
import { applyDesktopLiveUpdate, applySelectedTranscriptLiveUpdate, applyTranscriptDelta } from "./live-update";

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
const NEW_THREAD_PLACEHOLDER_TITLE = "New project";

function deriveThreadTitle(prompt: string): string {
  const firstLine = prompt.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (!firstLine) {
    return NEW_THREAD_PLACEHOLDER_TITLE;
  }
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}\u2026` : firstLine;
}

export function useDesktopAppState() {
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
      setSnapshot((current) => applyDesktopLiveUpdate(current, { type: "workspace-session", workspaceId: patch.workspaceId, session: patch.session, extensionUi: patch.extensionUi }));
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
      const nextTranscript = {
        workspaceId: delta.workspaceId,
        sessionId: delta.sessionId,
        transcript: deltaTranscript!,
      };
      if (incomingKey !== lastAppliedSessionKey) {
        applyTranscriptImmediately(nextTranscript);
        return;
      }
      pendingTranscript = nextTranscript;
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushTranscript);
      }
      if (coalesceTimer === null) {
        coalesceTimer = setTimeout(flushTranscript, 250);
      }
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

function useLiveEditStats(): ReadonlyMap<string, import("./ipc").LiveEditStats> {
  const [stats, setStats] = useState<ReadonlyMap<string, import("./ipc").LiveEditStats>>(() => new Map());

  useEffect(() => {
    const api = window.piApp;
    if (!api?.onLiveEditStats) return undefined;
    return api.onLiveEditStats((update) => {
      setStats((prev) => {
        const next = new Map(prev);
        if (update.added === 0 && update.removed === 0 && !prev.has(update.callId)) {
          // Initial zero-zero: store it so the spinner appears
          next.set(update.callId, update);
        } else {
          next.set(update.callId, update);
        }
        return next;
      });
    });
  }, []);

  return stats;
}

export function updateSnapshot(
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

function canTogglePrimarySidebar(_view: AppView | undefined): boolean {
  return true;
}

export function useRunningLabel(startedAt: string | undefined) {
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
  const liveEditStats = useLiveEditStats();
  // Per-session plan/build mode, owned here so it survives composer submits and
  // session switches. `planAwaitingBySession` marks a session whose plan-mode
  // run is pending a written plan; once that session is idle the composer shows
  // an "Execute plan" button.
  const [composerModeBySession, setComposerModeBySession] = useState<Record<string, ComposerMode>>({});
  const [planAwaitingBySession, setPlanAwaitingBySession] = useState<Record<string, boolean>>({});
  const [planReadyBySession, setPlanReadyBySession] = useState<Record<string, boolean>>({});
  const prevPlanStatusRef = useRef<Map<string, SessionStatus>>(new Map());
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [cavemanLevel, setCavemanLevel] = useState<CavemanLevel>("off");
  const [chassisActions, setChassisActions] = useState<ChassisAction[]>([]);
  const [activeStickyId, setActiveStickyId] = useState<string | null>(null);
  const [composerLayout, setComposerLayout] = useState<import("./composer-layout").ComposerLayoutData | null>(null);
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
  const [themeMode, setThemeMode] = useState<"system" | "light" | "dark" | "dracula">("system");
  const [buttonSoundSettings, setButtonSoundSettings] = useState<ButtonSoundSettings>(
    () => ({ ...DEFAULT_BUTTON_SOUND_SETTINGS })
  );
  const [smartCompactSettings, setSmartCompactSettings] = useState<import("./ipc").SmartCompactSettings>({});

  // Zoom % HUD. Zoom is owned by the main process (webContents.setZoomFactor)
  // and flows back via snapshot.zoomFactor; we mirror it to a CSS var so chrome
  // can compensate, and flash a transient % toast on change.
  const [zoomHudPercent, setZoomHudPercent] = useState<number | null>(null);
  const prevZoomFactorRef = useRef<number | null>(null);
  const zoomHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch smart compact settings on mount
  // Preload button click audio buffers so first Enter press has no latency
  useEffect(() => { preloadSounds(); }, []);

  useEffect(() => {
    const factor = snapshot?.zoomFactor ?? ZOOM_BASELINE;
    document.documentElement.style.setProperty("--zoom-factor", String(factor));
    const previous = prevZoomFactorRef.current;
    prevZoomFactorRef.current = factor;
    if (previous === null || previous === factor) {
      return;
    }
    setZoomHudPercent(zoomFactorToPercent(factor));
    if (zoomHudTimerRef.current) {
      clearTimeout(zoomHudTimerRef.current);
    }
    zoomHudTimerRef.current = setTimeout(() => setZoomHudPercent(null), 1200);
  }, [snapshot?.zoomFactor]);

  useEffect(() => () => {
    if (zoomHudTimerRef.current) {
      clearTimeout(zoomHudTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const api = window.piApp;
    if (!api) return;
    api.getSmartCompactSettings().then((settings) => {
      setSmartCompactSettings(settings);
    }).catch(() => {});
  }, []);

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
  const previousActiveViewRef = useRef<AppView | null>(null);
  const sessionComposerRef = useRef<SessionComposerHandle>(null);
  const prevSessionStatusRef = useRef<Map<string, SessionStatus>>(new Map());
  const lastErrorToastKeyRef = useRef("");
  const [subagentPanel, setSubagentPanel] = useState<{ readonly sessionFile: string; readonly name: string } | null>(null);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [environmentPanelOpen, setEnvironmentPanelOpen] = useState<boolean>(() => { try { return localStorage.getItem("pi:env-panel-open") !== "false"; } catch { return true; } });

  const [showContextPanel, setShowContextPanel] = useState(false);
  const [featureDoneState, setFeatureDoneState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [pendingScrollToMessageId, setPendingScrollToMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // Query that produced the jump, captured before the search palette clears it.
  const [highlightQuery, setHighlightQuery] = useState<string>("");
  const [advisorState, setAdvisorState] = useState(createEmptyAdvisorState());
  const [openTerminalSessionKey, setOpenTerminalSessionKey] = useState("");
  const [takeoverTerminalSessionKey, setTakeoverTerminalSessionKey] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(340);
  const [diffFileRequest, setDiffFileRequest] = useState<DiffPanelFileRequest | null>(null);
  const [diffRefreshNonce, _setDiffRefreshNonce] = useState(0);

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
      setCavemanLevel(config.enabled ? config.defaultLevel : "off");
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
    if (!snapshot) return;
    const root = document.documentElement;
    const mode = snapshot.composerDeviceMode;
    root.classList.add("composer-device", "composer-device--modular");
    root.classList.toggle("composer-device--metal-keys", mode === "modular-metal");
    root.classList.toggle("composer-device--cream", mode === "modular-cream");
  }, [snapshot, snapshot?.composerDeviceMode]);

  // Translate the streaming-reveal preset into the per-word effect tokens the
  // .sw CSS reads. Applied at the root so every streamed message inherits it;
  // a per-message localStorage `streamFx` override (devtools) stacks on top.
  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.setAttribute(
      "data-stream-fx",
      STREAM_REVEAL_FX_TOKENS[snapshot.streamReveal] ?? "blur",
    );
  }, [snapshot, snapshot?.streamReveal]);

  // Reveal speed (low/medium/high) read by the typewriter in message-markdown
  // off the document root. Orthogonal to the look preset above.
  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.setAttribute("data-stream-speed", snapshot.streamRevealSpeed ?? "medium");
  }, [snapshot, snapshot?.streamRevealSpeed]);

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

  useEffect(() => {
    if (!api || !snapshot?.selectedWorkspaceId) return;
    if (typeof api.listGhLoops === "function") void api.listGhLoops(snapshot.selectedWorkspaceId);
  }, [api, snapshot?.selectedWorkspaceId]);

  const selectedWorkspace = snapshot ? (getSelectedWorkspace(snapshot) ?? snapshot.workspaces[0]) : undefined;
  // Chassis Actions are scoped per project folder (#51): the active workspace path keys
  // both the action definitions and the sticky activation.
  const chassisFolderPath = selectedWorkspace?.path;
  const selectedSession = snapshot ? getSelectedSession(snapshot) : undefined;
  const globalSearch = useGlobalSearch({ state: snapshot, selectedWorkspace, selectedSession });
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
  // ── New-thread state (extracted hook) ───────────────────────────────────────
  const nt = useNewThreadState({
    snapshot,
    rootWorkspaceOptions,
    rootWorkspace,
    visibleWorkspaces,
    api: api!,
    setActiveView: (view: AppView) => { if (api) void updateSnapshot(api, setSnapshot, () => api.setActiveView(view)); },
    focusNewThreadComposer: () => { setTimeout(() => newThreadComposerRef.current?.focus(), 0); },
  });
  const newThreadRootWorkspaceId = nt.rootWorkspaceId;
  const setNewThreadRootWorkspaceId = nt.setRootWorkspaceId;
  const newThreadIsChat = nt.isChat;
  const setNewThreadIsChat = nt.setIsChat;
  const newThreadEnvironment = nt.environment;
  const setThreadLocation = nt.setEnvironment;
  const newThreadPrompt = nt.prompt;
  const setNewThreadPrompt = nt.setPrompt;
  const newThreadAttachments = nt.attachments;
  const setNewThreadAttachments = nt.setAttachments;
  const newThreadProvider = nt.provider;
  const setNewThreadProvider = nt.setProvider;
  const newThreadModelId = nt.modelId;
  const setNewThreadModelId = nt.setModelId;
  const newThreadThinkingLevel = nt.thinkingLevel;
  const setNewThreadThinkingLevel = nt.setThinkingLevel;
  const pendingNewThreadWorkspaceId = nt.pendingWorkspaceId;
  const setPendingNewThreadWorkspaceId = nt.setPendingWorkspaceId;
  const newThreadComposerMode = nt.composerMode;
  const setNewThreadComposerMode = nt.setComposerMode;
  const newThreadOrchestratorMode = nt.orchestratorMode;
  const setNewThreadOrchestratorMode = nt.setOrchestratorMode;
  const clearAllDrafts = nt.clearAllDrafts;

  // Branch + worktree picker state for new thread
  const [newThreadBranches, setNewThreadBranches] = useState<readonly import("./ipc").BranchInfo[]>([]);
  const [newThreadSelectedBranch, setNewThreadSelectedBranch] = useState<string>("");
  const [newThreadCurrentBranch, setNewThreadCurrentBranch] = useState<string>("");
  const [newThreadIsDirty, setNewThreadIsDirty] = useState<boolean>(false);
  const [newThreadWorktreeMode, setNewThreadWorktreeMode] = useState<"new" | "existing">("new");
  const [newThreadSelectedWorktreeId, setNewThreadSelectedWorktreeId] = useState<string>("");

  // Fetch branches when workspace changes or new-thread view opens
  useEffect(() => {
    if (!api || !newThreadRootWorkspaceId || snapshot?.activeView !== "new-thread") return;
    void api.listBranches(newThreadRootWorkspaceId).then((result) => {
      const list = (result?.branches ?? []).filter((b) => !b.isRemote);
      setNewThreadBranches(list);
      setNewThreadCurrentBranch(result?.currentBranch ?? "");
      setNewThreadIsDirty(result?.isDirty ?? false);
      // Default selection = current branch ("Local file state"): keep the
      // working tree as-is, no checkout.
      const current = list.find((b) => b.isCurrent);
      if (current) setNewThreadSelectedBranch(current.name);
      else if (list[0]) setNewThreadSelectedBranch(list[0].name);
    }).catch(() => {
      setNewThreadBranches([]);
      setNewThreadCurrentBranch("");
      setNewThreadIsDirty(false);
    });
  }, [api, newThreadRootWorkspaceId, snapshot?.activeView]);

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
    if (showContextPanel) {
      loadContextSnapshot();
    }
  }, [showContextPanel, loadContextSnapshot]);
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
  const selectedSessionComposerMode: ComposerMode = composerModeBySession[selectedSessionKey] ?? "build";
  const selectedPlanReady =
    selectedSessionComposerMode === "plan" && Boolean(planReadyBySession[selectedSessionKey]);
  const selectedPlanAwaiting = Boolean(planAwaitingBySession[selectedSessionKey]);
  const setSessionComposerMode = useCallback(
    (mode: ComposerMode) => {
      if (!selectedSessionKey) {
        return;
      }
      setComposerModeBySession((prev) => ({ ...prev, [selectedSessionKey]: mode }));
      if (mode === "build") {
        setPlanAwaitingBySession((prev) => ({ ...prev, [selectedSessionKey]: false }));
        setPlanReadyBySession((prev) => ({ ...prev, [selectedSessionKey]: false }));
      }
    },
    [selectedSessionKey],
  );
  // A plan-mode message was just sent: expect a plan, and hide any stale
  // "Execute plan" button until this new run completes.
  const handlePlanSubmitted = useCallback(() => {
    if (!selectedSessionKey) {
      return;
    }
    setPlanAwaitingBySession((prev) => ({ ...prev, [selectedSessionKey]: true }));
    setPlanReadyBySession((prev) => ({ ...prev, [selectedSessionKey]: false }));
  }, [selectedSessionKey]);
  const handleExecutePlan = useCallback(() => {
    if (!api || !selectedSessionKey) {
      return;
    }
    setComposerModeBySession((prev) => ({ ...prev, [selectedSessionKey]: "build" }));
    setPlanAwaitingBySession((prev) => ({ ...prev, [selectedSessionKey]: false }));
    setPlanReadyBySession((prev) => ({ ...prev, [selectedSessionKey]: false }));
    void updateSnapshot(api, setSnapshot, () =>
      api.submitComposer("Execute the plan above.", { mode: "build" }),
    );
  }, [api, selectedSessionKey, setSnapshot]);

  // Load the active folder's actions + persisted sticky activation, and reload
  // whenever the active folder changes (folder switch swaps buttons + toggles).
  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi || !chassisFolderPath) {
      setChassisActions([]);
      setActiveStickyId(null);
      return;
    }
    void piApi.getChassisFolder(chassisFolderPath).then((state) => {
      setChassisActions(state.actions);
      setActiveStickyId(state.activeStickyId);
    }).catch(() => {});
  }, [chassisFolderPath]);

  const refreshChassisActions = useCallback(() => {
    const piApi = window.piApp;
    if (!piApi || !chassisFolderPath) return;
    void piApi.getChassisFolder(chassisFolderPath).then((state) => {
      setChassisActions(state.actions);
      setActiveStickyId(state.activeStickyId);
    }).catch(() => {});
  }, [chassisFolderPath]);

  const handleRunChassisAction = useCallback((action: ChassisAction) => {
    if (!api || action.effect.type !== "submit") return;
    const text = action.effect.text;
    void updateSnapshot(api, setSnapshot, () => api.submitComposer(text));
  }, [api, setSnapshot]);

  const handleToggleChassisWrap = useCallback((action: ChassisAction) => {
    const piApi = window.piApp;
    if (!piApi || !chassisFolderPath) return;
    const next = toggleStickyActivation(activeStickyId, action.id);
    setActiveStickyId(next);
    void piApi.setChassisActivation(chassisFolderPath, next)
      .then((state) => setActiveStickyId(state.activeStickyId))
      .catch(() => {});
  }, [chassisFolderPath, activeStickyId]);

  const activeWrapTemplate = useMemo(() => {
    if (!activeStickyId) return null;
    const active = chassisActions.find((a) => a.id === activeStickyId);
    return active && active.trigger === "sticky" && active.effect.type === "wrap" ? active.effect.template : null;
  }, [activeStickyId, chassisActions]);

  // Load composer layout (app-global for MVP)
  useEffect(() => {
    const piApi = window.piApp;
    if (!piApi) return;
    void piApi.getComposerLayout().then((layout) => {
      if (layout) {
        setComposerLayout(layout);
      }
    }).catch(() => {});
  }, []);

  // Mark a session's plan as ready to execute when its plan-mode run finishes
  // (running -> idle). Edge-detecting on the prior snapshot status dedupes and
  // works even if the run completes while another session is on screen.
  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const prev = prevPlanStatusRef.current;
    const next = new Map<string, SessionStatus>();
    const becameReady: string[] = [];
    for (const workspace of snapshot.workspaces) {
      for (const session of workspace.sessions) {
        const key = `${workspace.id}:${session.id}`;
        next.set(key, session.status);
        if (prev.get(key) === "running" && session.status === "idle" && planAwaitingBySession[key]) {
          becameReady.push(key);
        }
      }
    }
    prevPlanStatusRef.current = next;
    if (becameReady.length > 0) {
      setPlanReadyBySession((current) => {
        const updated = { ...current };
        for (const key of becameReady) {
          updated[key] = true;
        }
        return updated;
      });
    }
  }, [snapshot, planAwaitingBySession]);
  const snapshotLastError = snapshot?.lastError;
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
  // When an extension command is actively running, keep its info-level output
  // visible — it's user-invoked progress, not background noise.
  const transcriptVerbose = snapshot?.transcriptVerbose ?? false;
  const commandActive = Boolean(
    selectedSessionKey && snapshot?.sessionExtensionUiBySession[selectedSessionKey]?.commandActive,
  );
  const visibleTranscript = useMemo(
    () =>
      transcriptVerbose || commandActive
        ? activeTranscript
        : activeTranscript.filter((item) => !(item.kind === "activity" && item.noise)),
    [activeTranscript, transcriptVerbose, commandActive],
  );
  const isTranscriptLoading = Boolean(selectedSession) && activeTranscript.length === 0 && (
    !selectedTranscript ||
    selectedTranscript.workspaceId !== selectedWorkspace?.id ||
    selectedTranscript.sessionId !== selectedSession?.id
  );
  const {
    pendingThreadStart,
    setPendingThreadStart,
    pendingOptimisticTranscript: _pendingOptimisticTranscript,
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
  const selectedExtensionUi = selectedSession ? snapshot?.sessionExtensionUiBySession[selectedSessionKey] : undefined;

  // Session keys that have running sub-agents (from the fleet widget).
  // Keeps the sidebar spinner visible while sub-agents are active even
  // though the main agent turn has finished (session status = "idle").
  const sessionsWithRunningSubagents = useMemo(() => {
    const result = new Set<string>();
    const extUi = snapshot?.sessionExtensionUiBySession;
    if (!extUi) return result;
    for (const [key, uiState] of Object.entries(extUi)) {
      const fleetWidget = uiState.widgets.find((w) => w.key === FLEET_WIDGET_KEY);
      if (!fleetWidget) continue;
      const fleet = parseFleet(fleetWidget.lines);
      if (fleet && fleet.count > 0) {
        result.add(key);
      }
    }
    return result;
  }, [snapshot?.sessionExtensionUiBySession]);
  const selectedWorkspaceCommandCompatibility = selectedWorkspace
    ? snapshot?.extensionCommandCompatibilityByWorkspace[selectedWorkspace.id] ?? []
    : [];

  // --- Extracted hooks ---
  const timelineScroll = useTimelineScroll({
    selectedSessionKey,
    activeView: snapshot?.activeView,
    activeTranscript,
    setShowDiffPanel,
  });
  const threadSearch = useThreadSearch(timelineScroll.timelinePaneRef);

  // Scroll to a transcript message when navigating from a search result.
  // NOTE: timelineScroll is a fresh object each render, so this effect re-runs
  // often during session load. We guard with a ref and detach the scroll from
  // the effect's cleanup so re-renders don't cancel an in-flight jump.
  const scrollHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingScrollToMessageId) return;
    if (activeTranscript.length === 0 || isTranscriptLoading) return;

    // Verify the target message actually exists in the current transcript
    // (it won't if we're still showing the old session while the new one loads).
    const targetExists = activeTranscript.some((msg) => msg.id === pendingScrollToMessageId);
    if (!targetExists) return;

    // Already handled this exact target — don't scroll again on re-render.
    if (scrollHandledRef.current === pendingScrollToMessageId) return;
    scrollHandledRef.current = pendingScrollToMessageId;

    const targetId = pendingScrollToMessageId;
    setPendingScrollToMessageId(null);

    // Detached from effect cleanup: two rAFs to let the timeline render the
    // target session's rows, then scroll + flash. Not cancelled on re-render.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timelineScroll.scrollToMessageId(targetId, activeTranscript);
        setHighlightedMessageId(targetId);
        setTimeout(() => {
          setHighlightedMessageId((current) => (current === targetId ? null : current));
        }, 2000);
      });
    });
  }, [pendingScrollToMessageId, activeTranscript, isTranscriptLoading, timelineScroll]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- focusComposer changes every render, intentional snapshot-only trigger
  }, [snapshot, api]);
  useEffect(() => {
    setOpenTerminalSessionKey("");
    setTakeoverTerminalSessionKey("");
  }, [selectedSessionKey]);
  const displayedSessionTitle = selectedExtensionUi?.title ?? selectedSession?.title ?? "";
  const activeHostDialog = selectedExtensionUi?.pendingDialogs[0];
  const activeQuestionnaireRequest = activeHostDialog?.kind === "questionnaire" ? activeHostDialog : undefined;
  const activeExtensionDialog = activeHostDialog?.kind !== "questionnaire" ? activeHostDialog : undefined;
  const activeTerminalCustom = selectedExtensionUi?.pendingTerminalCustom;
  // Generic activity for extension commands that don't (or no longer) show a
  // terminal-custom surface — covers the dead zone where an extension does
  // async work with no UI of its own.
  const extensionCommandWorking = Boolean(selectedExtensionUi?.commandActive) && !activeTerminalCustom;
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
        // its row "running" only through the create→dispatch gap (the backend
        // emits the new session before the message dispatch flips it to
        // running) and keep the prompt title until the generated one lands. If
        // the real row has already completed, preserve that terminal status so
        // the sidebar spinner stops even if transcript hydration is late.
        const pendingTitle = pendingThreadStart.title;
        return groups.map((group) => ({
          ...group,
          threads: group.threads.map((thread) => {
            if (thread.session.id !== realId) {
              return thread;
            }
            const shouldHoldRunning =
              thread.session.status === "running" || thread.session.isAwaitingAssistantText;
            return {
              ...thread,
              session: {
                ...thread.session,
                ...(shouldHoldRunning ? { status: "running" as const } : {}),
                title:
                  thread.session.title === NEW_THREAD_PLACEHOLDER_TITLE ? pendingTitle : thread.session.title,
              },
            };
          }),
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
    [snapshot, pendingThreadStart, recentlyDone, newThreadTitleFallback],
  );
  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      if (snapshot?.activeView === "new-thread" && !pendingThreadStart) {
        newThreadComposerRef.current?.focus();
      } else {
        composerRef.current?.focus();
      }
    });
  };
  const handleSetComposerMode = useCallback(
    (mode: ComposerMode) => {
      if (snapshot?.activeView === "new-thread" && !pendingThreadStart) {
        setNewThreadComposerMode(mode);
      } else if (selectedWorkspace && selectedSession) {
        setSessionComposerMode(mode);
      }
    },
    [snapshot?.activeView, pendingThreadStart, selectedWorkspace, selectedSession, setSessionComposerMode, setNewThreadComposerMode],
  );
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
  const updateNewThreadPrompt = useCallback((value: SetStateAction<string>) => {
    setNewThreadPrompt(value);
  }, [setNewThreadPrompt]);
  const handleViewFileInDiff = useCallback((path: string) => {
    setShowDiffPanel(true);
    setDiffFileRequest({ path, nonce: Date.now() });
  }, []);
  const handleRevealInFinder = useCallback((filePath: string) => {
    if (!api || !selectedWorkspace) return;
    void api.showFileInFolder(selectedWorkspace.id, filePath);
  }, [api, selectedWorkspace]);

  const [shortcutsSheetOpen, setShortcutsSheetOpen] = useState(false);
  const [pendingSidebarSelection, setPendingSidebarSelection] = useState<SidebarNavEntry | null>(null);
  const toggleShortcutsSheet = useCallback(() => setShortcutsSheetOpen((open) => !open), []);

  // --- Advisor panel ---
  const handleAdvisorIntent = useCallback(
    async (intent: AdvisorIntent) => {
      if (!api) return;
      const nextState = reduceAdvisorState(advisorState, intent);
      setAdvisorState(nextState);
      const effect = getAdvisorSideEffect(nextState, intent);
      if (!effect) return;

      switch (effect.type) {
        case "build-payload": {
          try {
            const payload = await api.buildHandoffPayload({
              workspaceId: effect.workspaceId,
              sessionId: effect.sessionId,
              scope: effect.scope,
            });
            setAdvisorState((prev) => ({ ...prev, tokenEstimate: payload.tokenEstimate }));
            const result = await api.createSeededSession({
              workspaceId: effect.workspaceId,
              title: "Advisor",
              seedText: payload.seedText,
            });
            setAdvisorState((prev) => ({
              ...prev,
              sessionId: result.sessionId,
              status: "ready",
              tokenEstimate: payload.tokenEstimate,
            }));
          } catch (err) {
            setAdvisorState((prev) => ({
              ...prev,
              status: "error",
              errorMessage: err instanceof Error ? err.message : "Failed to start advisor",
            }));
          }
          break;
        }
        case "build-questionnaire-payload": {
          try {
            const questionNote =
              `The user is unsure about the following questionnaire question:\n\n` +
              `**Question:** ${effect.questionPrompt}\n\n` +
              `**Options:**\n${effect.questionOptions.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
            const payload = await api.buildHandoffPayload({
              workspaceId: effect.workspaceId,
              sessionId: effect.sessionId,
              scope: "compressed",
              userNote: questionNote,
              framing: "You are an advisor helping a user decide between options in a questionnaire. Analyze each option and recommend the best choice.",
            });
            setAdvisorState((prev) => ({ ...prev, tokenEstimate: payload.tokenEstimate }));
            const result = await api.createSeededSession({
              workspaceId: effect.workspaceId,
              title: "Questionnaire Advisor",
              seedText: payload.seedText,
            });
            setAdvisorState((prev) => ({
              ...prev,
              sessionId: result.sessionId,
              status: "ready",
              tokenEstimate: payload.tokenEstimate,
            }));
          } catch (err) {
            setAdvisorState((prev) => ({
              ...prev,
              status: "error",
              errorMessage: err instanceof Error ? err.message : "Failed to start advisor",
            }));
          }
          break;
        }
        case "navigate-to-session": {
          if (selectedWorkspace) {
            await api.selectSession({ workspaceId: selectedWorkspace.id, sessionId: effect.sessionId });
          }
          break;
        }
      }
    },
    [advisorState, api, selectedWorkspace],
  );

  const toggleAdvisorPanel = useCallback(() => {
    if (advisorState.visible) {
      handleAdvisorIntent({ type: "close-advisor" });
    } else if (selectedWorkspace && selectedSession) {
      handleAdvisorIntent({
        type: "open-advisor",
        workspaceId: selectedWorkspace.id,
        sessionId: selectedSession.id,
      });
    }
  }, [advisorState.visible, selectedWorkspace, selectedSession, handleAdvisorIntent]);

  const toggleDiffPanel = useCallback(() => {
    const pane = timelineScroll.timelinePaneRef.current;
    const shouldPreserveBottom = pane ? isNearBottom(pane) || timelineScroll.pinnedToBottomRef.current : timelineScroll.pinnedToBottomRef.current;
    if (shouldPreserveBottom) {
      timelineScroll.preserveBottomOnNextPaneResizeRef.current = true;
    }

    setShowDiffPanel((prev) => !prev);

    if (!shouldPreserveBottom) {
      return;
    }

    timelineScroll.schedulePinnedBottomRealignment(3);
  }, [timelineScroll]);

  // --- Settings & Skills/Extensions handlers ---
  const settingsHandlers = useSettingsHandlers({
    api,
    setSnapshot,
    updateSnapshot,
    settingsWorkspace,
    selectedWorkspace,
    selectedSession,
    setThemeMode,
  });

  const allUndoOpsRef = useRef<readonly UndoEditOp[]>([]);
  const handleAllUndoOpsChange = useCallback((ops: readonly UndoEditOp[]) => {
    allUndoOpsRef.current = ops;
  }, []);

  const handleUndoAllEdits = useCallback(async () => {
    const ops = allUndoOpsRef.current;
    if (ops.length === 0) return { reverted: [], failed: [] };
    return settingsHandlers.handleUndoEdits(ops);
  }, [settingsHandlers]);

  const handleFeatureDone = useCallback(async () => {
    if (!selectedWorkspace || !selectedSession || !api) return;
    const title = selectedSession.title || "feature";
    const modelString = snapshot?.commitPushModel ?? "deepseek:deepseek-chat";
    setFeatureDoneState("working");
    try {
      const result = await api.featureDone({
        workspaceId: selectedWorkspace.id,
        threadTitle: title,
        modelString,
      });
      if (result.status === "ok") {
        setFeatureDoneState("done");
        showToast({ variant: "success", message: `Feature autoshipped — ${result.message}` });
      } else if (result.status === "conflicts" && result.handoffPrompt) {
        setFeatureDoneState("done");
        showToast({ variant: "success", message: "Merge conflicts found — spawning resolver thread…" });
        // Spawn a resolver thread in the same worktree
        await api.startThread({
          rootWorkspaceId: selectedWorkspace.id,
          environment: "local",
          prompt: result.handoffPrompt,
        });
      } else {
        setFeatureDoneState("error");
        showToast({ variant: "error", message: `Autoship failed — ${result.message}` });
      }
    } catch (err) {
      setFeatureDoneState("error");
      showToast({ variant: "error", message: `Autoship failed — ${String(err)}` });
    }
  }, [api, selectedWorkspace, selectedSession, snapshot?.commitPushModel]);

  const toggleEnvironmentPanel = useCallback(() => {
    setEnvironmentPanelOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("pi:env-panel-open", String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const skillsExtensionsHandlers = useSkillsExtensionsHandlers({
    api,
    setSnapshot,
    updateSnapshot,
    skillsWorkspace,
    extensionsWorkspace,
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusComposer reads refs, safe stable
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSnapshot/focusComposer are stable or ref-driven
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
      setThreadLocation("local");
      // No workspaces left — wipe all per-workspace drafts.
      clearAllDrafts();
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
  }, [rootWorkspaceOptions, setNewThreadRootWorkspaceId, setThreadLocation, setPendingNewThreadWorkspaceId, clearAllDrafts]);

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
  }, [pendingNewThreadWorkspaceId, rootWorkspaceOptions, snapshot, setNewThreadRootWorkspaceId, setPendingNewThreadWorkspaceId]);

  const resetNewThreadSurface = nt.reset;

  const primarySidebarToggleVisible = canTogglePrimarySidebar(snapshot?.activeView);
  const handleTogglePrimarySidebar = useCallback(() => {
    const sidebarState = sidebarToggleStateRef.current;
    const sidebarApi = sidebarState.api;
    if (!sidebarApi || !canTogglePrimarySidebar(sidebarState.activeView)) {
      return false;
    }
    void updateSnapshot(sidebarApi, setSnapshot, () => sidebarApi.setSidebarCollapsed(!sidebarState.sidebarCollapsed));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs pattern: reads sidebarToggleStateRef.current
  }, []);
  const sidebarToggleShortcutLabel = api ? getDesktopShortcutLabel(api.platform, "S") : "";
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
    [api, setSnapshot],
  );

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
    }

    if (
      snapshot.activeView === "threads" &&
      previousActiveViewRef.current !== "threads" &&
      selectedSession
    ) {
      focusComposer();
      if (timelineScroll.pinnedToBottomRef.current || timelineScroll.preserveBottomOnNextPaneResizeRef.current) {
        timelineScroll.preserveBottomOnNextPaneResizeRef.current = true;
        timelineScroll.schedulePinnedBottomRealignment(1);
      }
    }

    previousActiveViewRef.current = snapshot.activeView;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusComposer/timelineScroll ref reads intentional
  }, [timelineScroll.schedulePinnedBottomRealignment, selectedSession, selectedWorkspace?.id, snapshot]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSelectSession is intentionally stable (ref-driven)
  }, []);

  // --- Keyboard shortcuts (extracted) ---
  // Must be before the early return to preserve hook order.
  const setActiveView = (view: AppView) => {
    if (!api) return;
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

  const openAutomations = (workspaceId?: string) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("automations"));
    // Apply workspace filter if provided
    void updateSnapshot(api, setSnapshot, async () => {
      const state = await api.getState();
      return { ...state, automationFilterWorkspaceId: workspaceId || undefined };
    });
  };

  const openContext = () => {
    setShowContextPanel((prev) => !prev);
  };

  const openAgents = () => {
    setActiveView("agents");
  };

  const openTesting = () => {
    setActiveView("testing");
  };

  const openNewThreadSurface = nt.open;
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

  const handleSelectChat = (chatId: string) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.selectChat(chatId)).then(() => {
      focusComposer();
    });
  };

  useKeyboardShortcuts({
    api,
    snapshot: snapshot!,
    activeView: snapshot?.activeView ?? "threads",
    selectedWorkspace,
    selectedSession,
    threadGroups,
    chats,
    threadSearch,
    navigationHistory,
    modelSelectorRef,
    composerMode: newThreadComposerMode,
    onSetComposerMode: handleSetComposerMode,
    focusComposer,
    toggleDiffPanel,
    toggleAdvisorPanel,
    toggleTerminal,
    handleTogglePrimarySidebar,
    openShortcutsSheet: toggleShortcutsSheet,
    openSearchPalette: () => globalSearch?.open(),
    openSettings,
    openNewThreadSurface,
    navigateToEntry,
    handlePastedClipboardImage,
    setPendingNewThreadWorkspaceId,
    resetNewThreadSurface,
    onSelectSession: handleSelectSession,
    onSelectChat: handleSelectChat,
    onPendingSidebarSelection: setPendingSidebarSelection,
    onOpenAgents: openAgents,
    onOpenSkills: openSkills,
    onOpenExtensions: openExtensions,
    onOpenAutomations: openAutomations,
    onOpenContext: openContext,
    onOpenTesting: openTesting,
    onCopyLastResponse: () => {
      const lastAssistant = [...activeTranscript].reverse().find((msg) => msg.kind === "message" && msg.role === "assistant");
      if (lastAssistant && lastAssistant.kind === "message") {
        void navigator.clipboard.writeText(lastAssistant.text);
        showToast({ variant: "success", message: "Copied last response", autoDismissMs: 2000 });
      }
    },
  });

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
    showContextPanel ? "main--with-context" : "",
    advisorState.visible ? "main--with-advisor" : "",
    subagentPanel ? "main--with-subagent" : "",
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

  const setQueueMode = (enabled: boolean) => {
    void updateSnapshot(api, setSnapshot, () => api.setQueueMode(enabled));
  };
  const openKanbanView = () => {
    setActiveView("kanban");
  };

  const openNewChatSurface = nt.openChat;
  const handleNewThreadAddAttachments = nt.addAttachments;
  const handleNewThreadRemoveAttachment = nt.removeAttachment;

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



  const handleTrySkill = (command: string) => {
    void updateSnapshot(api, setSnapshot, () => api.setActiveView("threads"));
    sessionComposerRef.current?.fillFromSlash(command);
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
    // Look up workspace before archiving so we can offer worktree cleanup after.
    const ws = snapshot?.workspaces.find((w) => w.id === target.workspaceId);
    // Optimistically guard the row out of the active list immediately; the
    // guard is dropped once the backend snapshot confirms the archive.
    setRecentlyDone((prev) => {
      const next = new Set(prev);
      next.add(doneSessionKey(target.workspaceId, target.sessionId));
      return next;
    });
    void updateSnapshot(api, setSnapshot, () => api.archiveSession(target)).then(() => {
      if (ws?.kind === "worktree") {
        const rootId = ws.rootWorkspaceId ?? target.workspaceId;
        const worktrees = snapshot?.worktreesByWorkspace[rootId] ?? [];
        const worktreeRecord = worktrees.find((wt) => wt.linkedWorkspaceId === ws.id);
        if (worktreeRecord) {
          wsMenu.removeWorktree(rootId, worktreeRecord);
        }
      }
    });
  };

  const handleArchiveAllNonRunningSessions = (workspaceId: string, olderThanMs?: number) => {
    void updateSnapshot(api, setSnapshot, () => api.archiveAllNonRunningSessions(workspaceId, olderThanMs));
  };

  const handleRespondToExtensionDialog = (
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly answers: readonly { readonly id: string; readonly value: string; readonly label: string; readonly wasCustom: boolean; readonly index?: number }[] }
      | { readonly requestId: string; readonly cancelled: true }
      | { readonly requestId: string; readonly terminalInput: string },
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

  const handleTerminalCustomInput = (requestId: string, data: string) => {
    if (!selectedWorkspace || !selectedSession) {
      return;
    }
    void updateSnapshot(api, setSnapshot, () =>
      api.respondToHostUiRequest(selectedWorkspace.id, selectedSession.id, { requestId, terminalInput: data }),
    );
  };

  const handleUnarchiveSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unarchiveSession(target));
  };

  const handleSnoozeSession = (target: { workspaceId: string; sessionId: string }, until: string) => {
    void updateSnapshot(api, setSnapshot, () => api.snoozeSession(target, until));
  };

  const handleUnsnoozeSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unsnoozeSession(target));
  };

  const handleMarkToTestSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.markToTestSession(target));
  };

  const handleUnmarkToTestSession = (target: { workspaceId: string; sessionId: string }) => {
    void updateSnapshot(api, setSnapshot, () => api.unmarkToTestSession(target));
  };

  const handleCreateChat = () => {
    openNewChatSurface();
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
      showToast({ variant: "error", message: treeCommand.message, autoDismissMs: 6000 });
      return;
    }
    if (treeCommand?.type === "tree") {
      showToast({ variant: "error", message: "/tree is only available inside an existing session.", autoDismissMs: 6000 });
      return;
    }
    const input: StartChatInput = {
      prompt: composeOutgoingPrompt(submittedPrompt, { mode: newThreadComposerMode, isFirst: true, wrapTemplate: activeWrapTemplate ?? undefined }),
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
    const startedInPlanMode = newThreadComposerMode === "plan";
    const startWithOrchestrator = newThreadOrchestratorMode;
    setNewThreadOrchestratorMode(false);
    setNewThreadIsChat(false);
    const doStartChat = () => {
      void updateSnapshot(api, setSnapshot, () => api.startChat(input))
        .then((state) => {
        if (startedInPlanMode) {
          const newKey = `${state.selectedWorkspaceId}:${state.selectedSessionId}`;
          setComposerModeBySession((prev) => ({ ...prev, [newKey]: "plan" }));
          setPlanAwaitingBySession((prev) => ({ ...prev, [newKey]: true }));
        }
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
        showToast({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to start chat.",
          autoDismissMs: 6000,
        });
      });
    };
    if (startWithOrchestrator) {
      void updateSnapshot(api, setSnapshot, () => api.setSubagentSettings({ orchestratorMode: true })).then(doStartChat);
    } else {
      doStartChat();
    }
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
      showToast({ variant: "error", message: treeCommand.message, autoDismissMs: 6000 });
      return;
    }
    if (treeCommand?.type === "tree") {
      showToast({ variant: "error", message: "/tree is only available inside an existing session.", autoDismissMs: 6000 });
      return;
    }
    const modelConfig = {
      prompt: composeOutgoingPrompt(submittedPrompt, { mode: newThreadComposerMode, isFirst: true, wrapTemplate: activeWrapTemplate ?? undefined }),
      attachments: newThreadAttachments,
      provider: resolvedNewThreadProvider,
      modelId: resolvedNewThreadModelId,
      thinkingLevel: resolvedNewThreadThinkingLevel,
    };
    const input: StartThreadInput = {
      rootWorkspaceId: newThreadRootWorkspaceId,
      environment: newThreadEnvironment,
      ...modelConfig,
      ...(newThreadSelectedBranch && newThreadSelectedBranch !== newThreadCurrentBranch ? { startBranch: newThreadSelectedBranch } : {}),
      ...(newThreadEnvironment === "worktree" && newThreadWorktreeMode === "existing" && newThreadSelectedWorktreeId ? { existingWorktreeId: newThreadSelectedWorktreeId } : {}),
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
    const startedInPlanMode = newThreadComposerMode === "plan";
    const startWithOrchestrator = newThreadOrchestratorMode;
    setNewThreadOrchestratorMode(false);
    setThreadLocation("local");
    const doStartThread = () => {
      void updateSnapshot(api, setSnapshot, () =>
        api.startThread(input),
      ).then((state) => {
      if (startedInPlanMode) {
        const newKey = `${state.selectedWorkspaceId}:${state.selectedSessionId}`;
        setComposerModeBySession((prev) => ({ ...prev, [newKey]: "plan" }));
        setPlanAwaitingBySession((prev) => ({ ...prev, [newKey]: true }));
      }
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
      showToast({
        variant: "error",
        message: error instanceof Error ? error.message : "Failed to start thread.",
        autoDismissMs: 6000,
      });
    });
    };
    if (startWithOrchestrator) {
      void updateSnapshot(api, setSnapshot, () => api.setSubagentSettings({ orchestratorMode: true })).then(doStartThread);
    } else {
      doStartThread();
    }
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

  const handleGlobalSearchSelect = (result: GlobalSearchResult) => {
    // Capture the query BEFORE close() clears it, so we can highlight the word.
    const queryAtSelect = globalSearch.query;
    globalSearch.close();
    if (result.kind === "chat" && result.chatId) {
      handleSelectChat(result.chatId);
      return;
    }
    if (result.workspaceId && result.sessionId) {
      if (result.transcriptMessageId) {
        scrollHandledRef.current = null;
        // Suppress the load-time pin-to-bottom so the new session doesn't
        // flash to the bottom before our jump can position it on the match.
        timelineScroll.pinnedToBottomRef.current = false;
        timelineScroll.preserveBottomOnNextPaneResizeRef.current = false;
        setPendingScrollToMessageId(result.transcriptMessageId);
        setHighlightQuery(queryAtSelect);
      }
      handleSelectSession({ workspaceId: result.workspaceId, sessionId: result.sessionId });
    }
  };

  // ── Utility view dispatch ────────────────────────────────────────────────────
  const testingCount = snapshot.workspaces.reduce(
    (total, workspace) => total + workspace.sessions.filter((session) => session.toTestAt).length,
    0,
  );

  const utilityShellProps = {
    activeView: snapshot.activeView,
    snapshot,
    api: api!,
    setSnapshot,
    updateSnapshot,
    sidebarResize,
    sidebarCollapsed: snapshot.sidebarCollapsed ?? false,
    selectedWorkspace,
    selectedSession,
    chats,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    queueMode: snapshot.queueMode,
    pendingSidebarSelection,
    automations: snapshot.automations ?? [],
    onNewThreadForWorkspace: openNewThreadSurface,
    onSetActiveView: setActiveView,
    onOpenSkills: openSkills,
    onOpenExtensions: openExtensions,
    onOpenSettings: openSettings,
    onOpenKanban: openKanbanView,
    onOpenAutomations: openAutomations,
    onOpenAgents: openAgents,
    testingCount,
    onOpenTesting: openTesting,
    onSetQueueMode: setQueueMode,
    onArchiveSession: handleArchiveSession,
    onArchiveAllNonRunningSessions: handleArchiveAllNonRunningSessions,
    onSelectSession: handleSelectSession,
    onUnarchiveSession: handleUnarchiveSession,
    onSnoozeSession: handleSnoozeSession,
    onUnsnoozeSession: handleUnsnoozeSession,
    onMarkToTestSession: handleMarkToTestSession,
    onUnmarkToTestSession: handleUnmarkToTestSession,
    onCreateChat: handleCreateChat,
    onSelectChat: handleSelectChat,
    onArchiveChat: handleArchiveChat,
    onUnarchiveChat: handleUnarchiveChat,
    onRemoveChat: handleRemoveChat,
    primarySidebarToggleVisible,
    sidebarToggleShortcutLabel,
    onTogglePrimarySidebar: handleTogglePrimarySidebar,
    shortcutsSheetOpen,
    onCloseShortcutsSheet: () => setShortcutsSheetOpen(false),
    globalSearch,
    onGlobalSearchSelect: handleGlobalSearchSelect,
    restoreComposerFocus: focusComposer,
  } as const;

  if (snapshot.activeView === "settings") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <SettingsSurface
          snapshot={snapshot}
          rootWorkspaceOptions={rootWorkspaceOptions}
          settingsWorkspace={settingsWorkspace}
          settingsSection={settingsSection}
          settingsRuntime={settingsRuntime}
          settingsModelRuntime={settingsModelRuntime}
          themeMode={themeMode}
          notificationPermissionStatus={notificationPermissionStatus}
          notificationPermissionPending={notificationPermissionPending}
          buttonSoundSettings={buttonSoundSettings}
          smartCompactSettings={smartCompactSettings}
          cavemanLevel={cavemanLevel}
          onSetCavemanLevel={(level) => {
            setCavemanLevel(level);
            void window.piApp?.setCavemanOnLevel(level);
          }}
          rootWorkspace={rootWorkspace}
          api={api!}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          settingsHandlers={settingsHandlers}
          handleRequestNotificationPermission={handleRequestNotificationPermission}
          handleOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
          setSettingsWorkspaceId={setSettingsWorkspaceId}
          setSettingsSection={setSettingsSection}
          setActiveView={setActiveView}
          setButtonSoundSettings={setButtonSoundSettings}
          setSmartCompactSettings={setSmartCompactSettings}
          activeView={snapshot.activeView}
          queueMode={snapshot.queueMode}
          onSetActiveView={setActiveView}
          onSetQueueMode={setQueueMode}
          onOpenKanban={openKanbanView}
          chassisActions={chassisActions}
          refreshChassisActions={refreshChassisActions}
          chassisFolderPath={chassisFolderPath}
        />
      } />
    );
  }

  if (snapshot.activeView === "skills") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <SkillsSurface
          skillsWorkspace={skillsWorkspace}
          rootWorkspaceOptions={rootWorkspaceOptions}
          skillsRuntime={skillsRuntime}
          skillsQuery={skillsQuery}
          skillsShowDisabled={skillsShowDisabled}
          skillsCollapsedGroups={skillsCollapsedGroups}
          skillsSelectedPath={skillsSelectedPath}
          skillsExtensionsHandlers={skillsExtensionsHandlers}
          handleTrySkill={handleTrySkill}
          api={api!}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          setSkillsWorkspaceId={setSkillsWorkspaceId}
          setSkillsQuery={setSkillsQuery}
          setSkillsShowDisabled={setSkillsShowDisabled}
          setSkillsCollapsedGroups={setSkillsCollapsedGroups}
          setSkillsSelectedPath={setSkillsSelectedPath}
        />
      } />
    );
  }

  if (snapshot.activeView === "extensions") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <ExtensionsSurface
          extensionsWorkspace={extensionsWorkspace}
          extensionsRuntime={extensionsRuntime}
          extensionsCommandCompatibility={extensionsCommandCompatibility}
          smartCompactSettings={smartCompactSettings}
          skillsExtensionsHandlers={skillsExtensionsHandlers}
          api={api!}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
        />
      } />
    );
  }

  if (snapshot.activeView === "testing") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <TestingSurface
          snapshot={snapshot}
          onSelectSession={handleSelectSession}
          onSetActiveView={setActiveView}
          onUnmarkToTestSession={handleUnmarkToTestSession}
        />
      } />
    );
  }

  if (snapshot.activeView === "automations") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <AutomationsSurface
          snapshot={snapshot}
          selectedWorkspace={selectedWorkspace}
          rootWorkspaceOptions={rootWorkspaceOptions}
          api={api!}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onFireNow={(automationId, automationName, workspaceId, prompt) => {
            // Optimistic: inject a placeholder thread immediately and navigate
            // to it, same as creating a new thread normally.
            setPendingThreadStart({
              rootWorkspaceId: workspaceId,
              title: `⚡ ${automationName}`,
              priorSelectedSessionId: snapshot?.selectedSessionId,
              createdAt: new Date().toISOString(),
              prompt,
              attachments: [],
              provider: undefined,
              modelId: undefined,
              thinkingLevel: undefined,
              cavemanLevel: "off",
              composerMode: "build",
            });
            void updateSnapshot(api, setSnapshot, () => api.automationFireNow(automationId)).then((state) => {
              setPendingThreadStart((prev) =>
                prev
                  ? { ...prev, sessionId: state.selectedSessionId, workspaceId: state.selectedWorkspaceId }
                  : prev,
              );
            }).catch(() => {
              setPendingThreadStart(null);
            });
          }}
        />
      } />
    );
  }

  if (snapshot.activeView === "agents") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <AgentsSurface
          snapshot={snapshot}
          agentsWorkspace={rootWorkspace}
          agentsRuntime={rootWorkspace ? snapshot.runtimeByWorkspace[rootWorkspace.id] : undefined}
          settingsHandlers={settingsHandlers}
        />
      } />
    );
  }

  if (snapshot.activeView === "graph") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <GraphSurface
          api={api!}
          rootWorkspaceId={rootWorkspace?.id}
        />
      } />
    );
  }

  if (snapshot.activeView === "composer-layout") {
    return (
      <UtilitySurface {...utilityShellProps} content={
        <ComposerLayoutSurface
          composerLayout={composerLayout || getDefaultLayout()}
          deviceMode={snapshot.composerDeviceMode}
          api={api!}
          setSnapshot={setSnapshot}
          updateSnapshot={updateSnapshot}
          onBack={() => setActiveView("settings")}
        />
      } />
    );
  }

  const shellClassName = `shell${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;

  const shellStyle = snapshot.sidebarCollapsed
    ? undefined
    : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);

  return (
    <div className={shellClassName} style={shellStyle}>
      {globalSearch.isOpen ? (
        <SearchPalette
          query={globalSearch.query}
          scope={globalSearch.scope}
          archiveFilter={globalSearch.archiveFilter}
          results={globalSearch.results}
          currentProjectIds={globalSearch.currentProjectIds}
          activeIndex={globalSearch.activeIndex}
          onQueryChange={globalSearch.setQuery}
          onScopeChange={globalSearch.setScope}
          onArchiveFilterChange={globalSearch.setArchiveFilter}
          onActiveIndexChange={globalSearch.setActiveIndex}
          onSelect={handleGlobalSearchSelect}
          onClose={globalSearch.close}
          restoreFocus={focusComposer}
        />
      ) : null}
      {shortcutsSheetOpen ? (
        <ShortcutsSheet platform={api.platform} onClose={() => setShortcutsSheetOpen(false)} />
      ) : null}
      {(
        <Sidebar
          collapsed={snapshot.sidebarCollapsed}
          resize={sidebarResize}
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          chats={chats}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          sessionsWithRunningSubagents={sessionsWithRunningSubagents}
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
          queueMode={snapshot.queueMode}
          onArchiveSession={handleArchiveSession}
            onArchiveAllNonRunningSessions={handleArchiveAllNonRunningSessions}
          onSelectSession={handleSelectSession}
          onUnarchiveSession={handleUnarchiveSession}
          onSnoozeSession={handleSnoozeSession}
          onUnsnoozeSession={handleUnsnoozeSession}
          onMarkToTestSession={handleMarkToTestSession}
          onUnmarkToTestSession={handleUnmarkToTestSession}
          onCreateChat={handleCreateChat}
          onSelectChat={handleSelectChat}
          onArchiveChat={handleArchiveChat}
          onUnarchiveChat={handleUnarchiveChat}
          onRemoveChat={handleRemoveChat}
          pendingSidebarSelection={pendingSidebarSelection}
          automations={snapshot.automations ?? []}
          onOpenAutomations={openAutomations}
          onOpenAgents={openAgents}
          testingCount={testingCount}
          onOpenTesting={openTesting}
          onOpenSearch={globalSearch.open}
          threadTypeBySession={snapshot.threadTypeBySession}
          runtime={rootRuntime}
          ghLoops={snapshot.ghLoops}
          ghRunnerState={snapshot.ghRunnerState}
          onRunLoop={(workspaceId, loopNumber) => typeof api.runGhLoop === "function" && void api.runGhLoop(workspaceId, loopNumber)}
          onCancelGhRun={() => void api.cancelGhRun()}
        />
      )}

      <main className={mainClassName}>
        <Topbar
          activeView={snapshot.activeView}
          rootWorkspace={rootWorkspace}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          selectedSessionTitle={displayedSessionTitle || selectedSession?.title}
          api={api}
          terminalAvailable={Boolean(selectedSessionKey)}
          terminalVisible={isTerminalVisibleForSelectedThread}
          onToggleTerminal={toggleTerminal}
          externalTerminalAvailable={Boolean(selectedSessionKey) && selectedSession?.status !== "running"}
          onOpenExternalTerminal={openExternalTerminal}
          onToggleDiffPanel={toggleDiffPanel}
          showContextPanel={showContextPanel}
          onToggleContextPanel={openContext}
          showAdvisorPanel={advisorState.visible}
          onToggleAdvisorPanel={toggleAdvisorPanel}
          transcriptVerbose={transcriptVerbose}
          onSetTranscriptVerbose={(enabled) => {
            void updateSnapshot(api, setSnapshot, () => api.setTranscriptVerbose(enabled));
          }}
          onOpenGraph={() => setActiveView("graph")}
          environmentPanelOpen={environmentPanelOpen}
          onToggleEnvironmentPanel={toggleEnvironmentPanel}
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
              onSelectEnvironment={setThreadLocation}
              branches={newThreadBranches}
              selectedBranch={newThreadSelectedBranch}
              onSelectBranch={setNewThreadSelectedBranch}
              currentBranch={newThreadCurrentBranch}
              isDirty={newThreadIsDirty}
              existingWorktrees={activeWorktrees}
              worktreeMode={newThreadWorktreeMode}
              onSelectWorktreeMode={setNewThreadWorktreeMode}
              selectedExistingWorktreeId={newThreadSelectedWorktreeId}
              onSelectExistingWorktree={setNewThreadSelectedWorktreeId}
              onSetModel={(provider, modelId) => { setNewThreadProvider(provider); setNewThreadModelId(modelId); }}
              onSetThinking={setNewThreadThinkingLevel}
              onSetCavemanLevel={settingsHandlers.handleSetDefaultCavemanLevel}
              onSetComposerMode={setNewThreadComposerMode}
              orchestratorMode={newThreadOrchestratorMode}
              onToggleOrchestrator={() => setNewThreadOrchestratorMode((prev) => !prev)}
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
              chassisActions={chassisActions}
              onRunChassisAction={handleRunChassisAction}
              activeWrapId={activeStickyId}
              onToggleChassisWrap={handleToggleChassisWrap}
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
        ) : snapshot.activeView === "kanban" ? (
          <KanbanView
            threadGroups={threadGroups}
            selectedWorkspaceId={snapshot.selectedWorkspaceId}
            selectedSessionId={snapshot.selectedSessionId}
            onSelectSession={handleSelectSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
          />
        ) : pendingThreadStart || (selectedWorkspace && selectedSession) ? (
          <>
            <section className="canvas canvas--thread">
              <LoadingBar loading={pendingThreadStart ? false : isTranscriptLoading} />
              <div className="conversation conversation--thread">
                <SubagentLiveProvider widgets={selectedExtensionUi?.widgets ?? []}>
                <SubagentTimelineProvider transcript={threadViewTranscript}>
                <SubagentSessionOpenProvider value={(sessionFile, name) => setSubagentPanel({ sessionFile, name })}>
                <ConversationTimeline
                  transcript={threadViewTranscript}
                  isTranscriptLoading={pendingThreadStart ? false : isTranscriptLoading}
                  timelinePaneRef={timelineScroll.timelinePaneRef}
                  timelinePaneElementRef={timelineScroll.setTimelinePaneElement}
                  disableVirtualization={timelineScroll.disableTimelineVirtualization}
                  onDisableVirtualizationReady={timelineScroll.finalizeTimelineVirtualizationDisable}
                  onTimelineScroll={timelineScroll.handleTimelineScroll}
                  threadSearch={threadSearch}
                  showJumpToLatest={timelineScroll.showJumpToLatest}
                  onJumpToLatest={timelineScroll.jumpToLatest}
                  onContentHeightChange={timelineScroll.handleTimelineContentHeightChange}
                  onViewFileInDiff={handleViewFileInDiff}
                  onRevealInFinder={handleRevealInFinder}
                  onUndoEdits={settingsHandlers.handleUndoEdits}
                  onRedoEdits={settingsHandlers.handleRedoEdits}
                  onAllUndoOpsChange={handleAllUndoOpsChange}
                  isRunning={threadViewIsRunning}
                  workingLabel={pendingThreadStart ? "Preparing your thread…" : undefined}
                  highlightedMessageId={highlightedMessageId}
                  highlightQuery={highlightedMessageId ? highlightQuery : undefined}
                  liveEditStats={liveEditStats}
                />
                </SubagentSessionOpenProvider>
                </SubagentTimelineProvider>
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
              smartCompactSettings={smartCompactSettings}
              snapshotComposerAttachments={snapshotComposerAttachments}
              queuedMessages={queuedComposerMessages}
              editingQueuedMessageId={editingQueuedMessageId}
              cavemanLevel={cavemanLevel}
              composerMode={selectedSessionComposerMode}
              onSetComposerMode={setSessionComposerMode}
              orchestratorMode={snapshot.subagentSettings.orchestratorMode}
              onToggleOrchestrator={() => {
                void updateSnapshot(api, setSnapshot, () => api.setSubagentSettings({orchestratorMode: !snapshot.subagentSettings.orchestratorMode}));
              }}
              planReady={selectedPlanReady}
              planAwaiting={selectedPlanAwaiting}
              onExecutePlan={handleExecutePlan}
              onPlanSubmitted={handlePlanSubmitted}
              runningLabel={runningLabel}
              hasSnapshot={Boolean(snapshot)}
              persistedComposerDraft={persistedComposerDraft}
              composerDraftSyncNonce={snapshot?.composerDraftSyncNonce ?? 0}
              composerDraftSyncSource={snapshot?.composerDraftSyncSource}
              composerRef={composerRef}
              modelSelectorRef={modelSelectorRef}
              timelinePaneRef={timelineScroll.timelinePaneRef}
              pinnedToBottomRef={timelineScroll.pinnedToBottomRef}
              preserveBottomOnNextPaneResizeRef={timelineScroll.preserveBottomOnNextPaneResizeRef}
              requestPinnedBottomAlignment={timelineScroll.requestPinnedBottomAlignment}
              focusComposer={focusComposer}
              openTreeModal={openTreeModal}
              openSettings={openSettings}
              onSetModel={settingsHandlers.handleSetSessionModel}
              onSetThinking={settingsHandlers.handleSetSessionThinking}
              onSetCavemanLevel={settingsHandlers.handleSetSessionCavemanLevel}
              onOpenModelSettings={(section) =>
                openSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id, section)
              }
              handleClipboardImageShortcut={handleClipboardImageShortcut}
              questionnaireRequest={activeQuestionnaireRequest}
              onRespondToQuestionnaire={handleRespondToExtensionDialog}
              onUnarchiveSession={handleUnarchiveSession}
              chassisActions={chassisActions}
              onRunChassisAction={handleRunChassisAction}
              activeWrapId={activeStickyId}
              onToggleChassisWrap={handleToggleChassisWrap}
              activeWrapTemplate={activeWrapTemplate}
              composerLayout={composerLayout}
            />
            ) : (
              <PendingComposer
                runtime={rootRuntime}
                provider={pendingThreadStart?.provider}
                modelId={pendingThreadStart?.modelId}
                thinkingLevel={pendingThreadStart?.thinkingLevel}
                cavemanLevel={pendingThreadStart?.cavemanLevel ?? cavemanLevel}
                composerMode={pendingThreadStart?.composerMode ?? "build"}
                prompt={pendingThreadStart?.prompt}
                chassisActions={chassisActions}
                onRunChassisAction={handleRunChassisAction}
                activeWrapId={activeStickyId}
                onToggleChassisWrap={handleToggleChassisWrap}
              />
            )}
            {activeExtensionDialog ? (
              <ExtensionDialog dialog={activeExtensionDialog} onRespond={handleRespondToExtensionDialog} />
            ) : null}
            {activeTerminalCustom ? (
              <TerminalCustomOverlay request={activeTerminalCustom} onInput={handleTerminalCustomInput} />
            ) : null}
            {extensionCommandWorking ? (
              <div className="extension-command-pill" role="status" aria-live="polite">
                <span className="extension-command-pill__dot" />
                <span>Extension working…</span>
              </div>
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
                  New project
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
            onUndoAllEdits={handleUndoAllEdits}
          />
        ) : null}
        {showContextPanel ? (
          <aside className="context-panel" data-testid="context-panel">
            <ContextSurface
              contextWorkspace={contextWorkspace}
              contextRuntime={contextRuntime}
              contextSnapshot={contextSnapshot}
              contextLoading={contextLoading}
              loadContextSnapshot={loadContextSnapshot}
              api={api!}
            />
          </aside>
        ) : null}
        {subagentPanel ? (
          <SubagentSessionPanel
            sessionFile={subagentPanel.sessionFile}
            name={subagentPanel.name}
            api={api}
            onClose={() => setSubagentPanel(null)}
            ConversationTimelineComponent={ConversationTimeline}
          />
        ) : null}
        {advisorState.visible ? (
          <AdvisorPanel
            visible={advisorState.visible}
            advisorSessionId={advisorState.sessionId}
            sourceSessionId={selectedSession?.id ?? ""}
            sourceWorkspaceId={selectedWorkspace?.id ?? ""}
            status={advisorState.status}
            scope={advisorState.scope}
            tokenEstimate={advisorState.tokenEstimate}
            errorMessage={advisorState.errorMessage}
            api={api}
            onClose={() => handleAdvisorIntent({ type: "close-advisor" })}
            onHandBack={(text) => {
              handleAdvisorIntent({ type: "hand-back" });
              void api.updateComposerDraft(text);
            }}
            onPromoteToThread={() => handleAdvisorIntent({ type: "promote-to-thread" })}
            onScopeChange={(scope) => handleAdvisorIntent({ type: "set-scope", scope })}
            onReloadPayload={() => {
              if (selectedWorkspace && selectedSession) {
                handleAdvisorIntent({
                  type: "open-advisor",
                  workspaceId: selectedWorkspace.id,
                  sessionId: selectedSession.id,
                });
              }
            }}
          />
        ) : null}
      {environmentPanelOpen && selectedWorkspace && snapshot?.activeView !== "new-thread" ? (
        <EnvironmentPanel
          selectedWorkspace={selectedWorkspace}
          selectedWorktree={selectedWorktree}
          rootWorkspace={rootWorkspace}
          wsMenu={wsMenu}
          onToggleDiffPanel={toggleDiffPanel}
          onFeatureDone={handleFeatureDone}
          featureDoneState={featureDoneState}
          commitPushModel={snapshot.commitPushModel}
          commitPushMode={snapshot.commitPushMode}
          selectedRuntime={rootRuntime}
          api={api}
          sessionStatus={selectedSession?.status}
          onSetCommitPushMode={(mode) => { void api.setCommitPushMode(mode); }}
        />
      ) : null}

      </main>
      {/* Rendered last so its -webkit-app-region:no-drag wins over the topbar's
          drag region when the sidebar is collapsed. Electron computes draggable
          regions in DOM order, not z-index, so an earlier no-drag toggle gets
          re-covered by the later topbar drag region and swallows the click. */}
      {primarySidebarToggleVisible ? (
        <SidebarToggleButton
          collapsed={snapshot.sidebarCollapsed}
          shortcutLabel={sidebarToggleShortcutLabel}
          onToggle={handleTogglePrimarySidebar}
        />
      ) : null}
      {zoomHudPercent !== null ? (
        <div className="zoom-hud" role="status" aria-live="polite">{zoomHudPercent}%</div>
      ) : null}
      <ImageLightbox />
      {import.meta.env.DEV && <Agentation />}
    </div>
  );
}

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}

