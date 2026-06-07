import { useEffect, useRef, type RefObject } from "react";
import {
  desktopCommands,
  getDesktopCommandFromShortcut,
  type PiDesktopCommand,
} from "../ipc";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, SessionRecord, WorkspaceRecord, ChatRecord } from "../desktop-state";
import type { useThreadSearch } from "./use-thread-search";
import type { useNavigationHistory } from "./use-navigation-history";
import type { ThreadGroup } from "../thread-groups";
import { buildSidebarNavList, type SidebarNavEntry } from "./build-sidebar-nav-list";
import { installPhysicalKeyFeedback } from "../physical-key-feedback";
import { installShortcutHints } from "../shortcut-hints";
import type { PiDesktopApi } from "../ipc";
import { playRotary } from "../button-click-sound";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyboardShortcutDeps {
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadGroups: readonly ThreadGroup[];
  readonly chats: readonly ChatRecord[];
  readonly threadSearch: ReturnType<typeof useThreadSearch>;
  readonly navigationHistory: ReturnType<typeof useNavigationHistory>;
  readonly modelSelectorRef: RefObject<{ openModelDropdown: () => void; selectSliderSlot: (index: number) => void; cycleThinkingLevel: (direction: -1 | 1) => void } | null>;
  readonly composerMode: import("../composer-mode").ComposerMode;
  readonly onSetComposerMode: (mode: import("../composer-mode").ComposerMode) => void;
  readonly focusComposer: () => void;
  readonly toggleDiffPanel: () => void;
  readonly toggleAdvisorPanel?: () => void;
  readonly toggleTerminal: () => void;
  readonly handleTogglePrimarySidebar: () => boolean;
  readonly openShortcutsSheet: () => void;
  readonly openSearchPalette: () => void;
  readonly openSettings: (workspaceId?: string, section?: import("../settings-view").SettingsSection) => void;
  readonly openNewThreadSurface: (workspaceId?: string) => void;
  readonly navigateToEntry: (entry: { activeView: import("../desktop-state").AppView; selectedWorkspaceId: string; selectedSessionId: string }) => void;
  readonly handlePastedClipboardImage: (image: import("../desktop-state").ComposerImageAttachment) => void;
  readonly setPendingNewThreadWorkspaceId: (id: string) => void;
  readonly resetNewThreadSurface: (workspaceId?: string) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectChat: (chatId: string) => void;
  readonly onPendingSidebarSelection: (entry: SidebarNavEntry | null) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts({
  api,
  snapshot,
  selectedWorkspace,
  selectedSession,
  threadGroups,
  chats,
  threadSearch,
  navigationHistory,
  modelSelectorRef,
  composerMode,
  onSetComposerMode,
  focusComposer,
  toggleDiffPanel,
  toggleAdvisorPanel,
  toggleTerminal,
  handleTogglePrimarySidebar,
  openShortcutsSheet,
  openSearchPalette,
  openSettings,
  openNewThreadSurface,
  navigateToEntry,
  handlePastedClipboardImage,
  setPendingNewThreadWorkspaceId,
  resetNewThreadSurface,
  onSelectSession,
  onSelectChat,
  onPendingSidebarSelection,
}: KeyboardShortcutDeps): void {
  // Sidebar keyboard navigation state (Cmd+Shift+Arrow)
  const pendingNavIndexRef = useRef<number>(-1);
  const pendingMetaReleaseRef = useRef(false);
  // Install physical key click feedback + hold-⌘ shortcut hints once.
  useEffect(() => installPhysicalKeyFeedback(), []);
  useEffect(() => installShortcutHints(), []);

  useEffect(() => {
    const cycleThinking = () => {
      const session = selectedSession;
      const workspace = selectedWorkspace;
      if (!session || !workspace || !api) return;
      const currentLevel = session.config?.thinkingLevel ?? "off";
      const runtime = snapshot?.runtimeByWorkspace[workspace.id];
      // Resolve the effective model (default model when the session has no
      // explicit override) so the cycle never offers levels the model doesn't
      // support — matching the reasoning dial and avoiding clamp snap-back.
      const provider = session.config?.provider ?? runtime?.settings.defaultProvider;
      const modelId = session.config?.modelId ?? runtime?.settings.defaultModelId;
      const modelRecord = runtime?.models.find((m) => m.providerId === provider && m.modelId === modelId);
      // Cycle through every level the model supports, in canonical dial order
      // (including "off" and "minimal"), so Shift+Tab matches the reasoning dial.
      const availableLevels = modelRecord?.availableThinkingLevels ?? ["off"];
      if (availableLevels.length === 0) return;
      const currentIndex = availableLevels.indexOf(currentLevel);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % availableLevels.length : 0;
      const next = availableLevels[nextIndex];
      if (next) {
        void api.setSessionThinkingLevel(
          workspace.id,
          session.id,
          next as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
        );
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
      } else if (command === desktopCommands.setBuildMode) {
        playRotary();
        onSetComposerMode("build");
        return true;
      } else if (command === desktopCommands.setPlanMode) {
        playRotary();
        onSetComposerMode("plan");
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

      // Cmd+K opens scoped thread/chat search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault();
        openSearchPalette();
        return;
      }

      // Cmd+/ toggles the shortcuts reference sheet
      if ((event.metaKey || event.ctrlKey) && event.key === "/" && !event.shiftKey) {
        event.preventDefault();
        openShortcutsSheet();
        return;
      }

      // Cmd+D toggles diff panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && !event.shiftKey) {
        event.preventDefault();
        toggleDiffPanel();
        return;
      }

      // Cmd+Shift+A toggles advisor panel
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && event.shiftKey) {
        event.preventDefault();
        toggleAdvisorPanel?.();
        return;
      }

      // Cmd+T opens model picker (outside terminal)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t" && !event.shiftKey) {
        event.preventDefault();
        modelSelectorRef.current?.openModelDropdown();
        return;
      }

      // Cmd+L focuses composer
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l" && !event.shiftKey) {
        event.preventDefault();
        playRotary();
        focusComposer();
        return;
      }

      // Cmd+1/2/3 selects model slot, Cmd+4 opens model dropdown
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const digit = parseInt(event.key);
        if (digit >= 1 && digit <= 3) {
          event.preventDefault();
          playRotary();
          modelSelectorRef.current?.selectSliderSlot(digit - 1);
          return;
        }
        if (digit === 4) {
          event.preventDefault();
          playRotary();
          modelSelectorRef.current?.openModelDropdown();
          return;
        }
      }

      // Cmd+P toggles plan mode, Cmd+B toggles build mode
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key.toLowerCase() === "p") {
          event.preventDefault();
          playRotary();
          onSetComposerMode("plan");
          return;
        }
        if (event.key.toLowerCase() === "b") {
          event.preventDefault();
          playRotary();
          onSetComposerMode("build");
          return;
        }
      }

      // Cmd+ArrowUp/Down adjusts thinking level. (Cmd+Left/Right are left to the
      // textarea for native line-start/line-end navigation.)
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          playRotary();
          modelSelectorRef.current?.cycleThinkingLevel(1);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          playRotary();
          modelSelectorRef.current?.cycleThinkingLevel(-1);
          return;
        }
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

    // Sidebar keyboard navigation: Cmd+Shift+ArrowDown/Up moves a pending
    // highlight through the flattened thread+chat list. The actual selection
    // is deferred until the Meta key is released.
    const handleSidebarNavKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const navList = buildSidebarNavList(threadGroups, chats);
      if (navList.length === 0) return;

      event.preventDefault();
      playRotary();

      const direction = event.key === "ArrowDown" ? 1 : -1;
      let nextIndex: number;

      if (pendingNavIndexRef.current === -1) {
        // First press: start from the currently selected session/chat.
        const currentSessionId = selectedSession?.id;
        const currentWorkspaceId = selectedWorkspace?.id;
        const currentIndex = navList.findIndex(
          (entry) => entry.sessionId === currentSessionId && entry.workspaceId === currentWorkspaceId,
        );
        nextIndex = currentIndex >= 0 ? currentIndex + direction : (direction === 1 ? 0 : navList.length - 1);
      } else {
        nextIndex = pendingNavIndexRef.current + direction;
      }

      // Wrap around.
      nextIndex = ((nextIndex % navList.length) + navList.length) % navList.length;

      pendingNavIndexRef.current = nextIndex;
      pendingMetaReleaseRef.current = true;
      onPendingSidebarSelection(navList[nextIndex] ?? null);
    };

    // Commit pending sidebar selection when Meta key is released.
    const handleSidebarNavKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Meta" && event.key !== "Control") return;
      if (!pendingMetaReleaseRef.current) return;

      const index = pendingNavIndexRef.current;
      pendingNavIndexRef.current = -1;
      pendingMetaReleaseRef.current = false;

      const navList = buildSidebarNavList(threadGroups, chats);
      const entry = index >= 0 && index < navList.length ? navList[index] : null;
      onPendingSidebarSelection(null);

      if (entry) {
        if (entry.kind === "chat") {
          onSelectChat(entry.sessionId);
        } else {
          onSelectSession({ workspaceId: entry.workspaceId, sessionId: entry.sessionId });
        }
      }
    };

    // Cancel pending nav on Escape.
    const handleSidebarNavEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && pendingMetaReleaseRef.current) {
        pendingNavIndexRef.current = -1;
        pendingMetaReleaseRef.current = false;
        onPendingSidebarSelection(null);
      }
    };

    window.addEventListener("keydown", handleSidebarNavKeyDown);
    window.addEventListener("keyup", handleSidebarNavKeyUp);
    window.addEventListener("keydown", handleSidebarNavEscape);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      removeCommandListener?.();
      removeWorkspacePickedListener?.();
      removeClipboardImageListener?.();
      window.removeEventListener("keydown", handleSidebarNavKeyDown);
      window.removeEventListener("keyup", handleSidebarNavKeyUp);
      window.removeEventListener("keydown", handleSidebarNavEscape);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedWorkspace,
    selectedWorkspace?.id,
    selectedWorkspace?.rootWorkspaceId,
    snapshot,
    threadGroups,
    chats,
    threadSearch,
    api,
    composerMode,
    onSetComposerMode,
    focusComposer,
    toggleDiffPanel,
    toggleAdvisorPanel,
    toggleTerminal,
    handleTogglePrimarySidebar,
    openShortcutsSheet,
    navigationHistory,
    navigateToEntry,
    openSettings,
    openSearchPalette,
    openNewThreadSurface,
    modelSelectorRef,
    handlePastedClipboardImage,
    setPendingNewThreadWorkspaceId,
    resetNewThreadSurface,
    selectedSession,
    onSelectSession,
    onSelectChat,
    onPendingSidebarSelection,
  ]);
}
