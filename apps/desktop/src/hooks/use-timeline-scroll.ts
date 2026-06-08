import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { VIRTUALIZATION_THRESHOLD } from "../conversation-timeline";
import type { AppView, SelectedTranscriptRecord } from "../desktop-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNearBottom(element: HTMLDivElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 32;
}

function buildTranscriptChangeMarker(sessionKey: string, transcript: SelectedTranscriptRecord["transcript"]): string {
  const lastItem = transcript.at(-1);
  return `${sessionKey}:${transcript.length}:${lastItem ? JSON.stringify(lastItem) : ""}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineScrollHandle {
  /** Ref to attach to the scrollable timeline pane element. */
  readonly timelinePaneRef: React.RefObject<HTMLDivElement | null>;
  /** Callback ref for the timeline pane DOM node (handles mount/unmount bookkeeping). */
  readonly setTimelinePaneElement: (node: HTMLDivElement | null) => void;
  /** Force-scroll to the bottom of the timeline. */
  readonly scrollTimelineToBottom: (behavior?: ScrollBehavior) => void;
  /** Request a pinned-bottom alignment (with optional exact-restore for long transcripts). */
  readonly requestPinnedBottomAlignment: (behavior?: ScrollBehavior, options?: { readonly preferExactRestore?: boolean }) => void;
  /** Finalize virtualization disable after the timeline has remounted with virtualization off. */
  readonly finalizeTimelineVirtualizationDisable: () => void;
  /** Schedule a pinned-bottom realignment after N animation frames. */
  readonly schedulePinnedBottomRealignment: (delayFrames?: number) => void;
  /** Handle scroll events on the timeline pane. */
  readonly handleTimelineScroll: () => void;
  /** Jump to the latest message (smooth scroll). */
  readonly jumpToLatest: () => void;
  /** Scroll to a specific message by ID. Unpins from bottom. */
  readonly scrollToMessageId: (messageId: string, transcript: readonly import("../desktop-state").TranscriptMessage[]) => void;
  /** Handle content height changes in the timeline. */
  readonly handleTimelineContentHeightChange: () => void;
  /** Whether the "jump to latest" button should be visible. */
  readonly showJumpToLatest: boolean;
  /** Whether timeline virtualization is currently disabled. */
  readonly disableTimelineVirtualization: boolean;
  /** Mount-version counter that increments on each timeline pane remount. */
  readonly timelinePaneMountVersion: number;
  /** Whether the user is currently pinned to the bottom. */
  readonly pinnedToBottomRef: React.RefObject<boolean>;
  /** Whether the next pane resize should preserve bottom position. */
  readonly preserveBottomOnNextPaneResizeRef: React.RefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTimelineScroll({
  selectedSessionKey,
  activeView,
  activeTranscript,
  setShowDiffPanel: _setShowDiffPanel,
}: {
  readonly selectedSessionKey: string;
  readonly activeView: AppView | undefined;
  readonly activeTranscript: readonly import("../desktop-state").TranscriptMessage[];
  readonly setShowDiffPanel: Dispatch<SetStateAction<boolean>>;
}): TimelineScrollHandle {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [disableTimelineVirtualization, setDisableTimelineVirtualization] = useState(true);
  const [timelinePaneMountVersion, setTimelinePaneMountVersion] = useState(0);

  const timelinePaneRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const previousTimelinePaneSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastTimelineScrollTopBySessionRef = useRef(new Map<string, number>());
  const lastTimelinePinnedBySessionRef = useRef(new Map<string, boolean>());
  const preserveBottomOnNextPaneResizeRef = useRef(false);
  const exactBottomRestoreSessionKeyRef = useRef<string | null>(null);
  const deferredPinnedBottomAlignmentRef = useRef(false);
  const pendingPinnedBottomBehaviorRef = useRef<ScrollBehavior>("auto");
  const lastTranscriptMarkerRef = useRef("");

  // -- internal helpers ----------------------------------------------------

  const resetExactBottomRestoreState = useCallback((nextSessionKey: string | null = null) => {
    exactBottomRestoreSessionKeyRef.current = nextSessionKey;
    deferredPinnedBottomAlignmentRef.current = false;
    pendingPinnedBottomBehaviorRef.current = "auto";
  }, []);

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const pane = timelinePaneRef.current;
    if (!pane) return;

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

      if (remainingChecks <= 0) return;

      window.requestAnimationFrame(() => {
        if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) {
          return;
        }
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
    if (!pane || activeView !== "threads") {
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
  }, [scrollTimelineToBottom, selectedSessionKey, activeView, resetExactBottomRestoreState]);

  const setTimelinePaneElement = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    if (!node) return;

    setTimelinePaneMountVersion((current) => current + 1);

    const savedPinned = lastTimelinePinnedBySessionRef.current.get(selectedSessionKey);
    const savedScrollTop = lastTimelineScrollTopBySessionRef.current.get(selectedSessionKey);

    if (!selectedSessionKey || activeView !== "threads") {
      setDisableTimelineVirtualization(false);
      return;
    }

    const shouldRestoreBottom = (savedPinned ?? pinnedToBottomRef.current) || preserveBottomOnNextPaneResizeRef.current;
    if (shouldRestoreBottom) {
      preserveBottomOnNextPaneResizeRef.current = true;
      node.scrollTop = node.scrollHeight;
      window.requestAnimationFrame(() => {
        if (timelinePaneRef.current !== node) return;
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
      if (timelinePaneRef.current !== node) return;
      setDisableTimelineVirtualization(false);
    });
  }, [selectedSessionKey, activeView, requestPinnedBottomAlignment, resetExactBottomRestoreState]);

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

  const handleTimelineScroll = useCallback(() => {
    const pane = timelinePaneRef.current;
    if (!pane) return;

    const pinned = isNearBottom(pane);
    if (!pinned) {
      preserveBottomOnNextPaneResizeRef.current = false;
      resetExactBottomRestoreState();
    }

    pinnedToBottomRef.current = pinned;
    lastTimelineScrollTopBySessionRef.current.set(selectedSessionKey, pane.scrollTop);
    lastTimelinePinnedBySessionRef.current.set(selectedSessionKey, pinned);
    if (pinned) {
      setShowJumpToLatest(false);
    }
  }, [selectedSessionKey, resetExactBottomRestoreState]);

  const jumpToLatest = useCallback(() => {
    requestPinnedBottomAlignment("smooth", { preferExactRestore: true });
  }, [requestPinnedBottomAlignment]);

  const scrollToMessageId = useCallback((messageId: string, transcript: readonly import("../desktop-state").TranscriptMessage[]) => {
    const pane = timelinePaneRef.current;
    if (!pane || !messageId) return;

    // Unpin from bottom so we can scroll to the target.
    pinnedToBottomRef.current = false;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState();
    setShowJumpToLatest(true);

    // Try direct DOM lookup first (element may be in the virtualized window).
    const element = pane.querySelector(`[data-message-id="${messageId}"]`);
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    // Element is virtualized out — estimate position from transcript index.
    const index = transcript.findIndex((msg) => msg.id === messageId);
    if (index === -1) return;

    // Use a rough estimate: ~60px per row + 14px gap.
    const estimatedRowHeight = 74;
    const targetScrollTop = Math.max(0, index * estimatedRowHeight - pane.clientHeight / 3);
    pane.scrollTo({ top: targetScrollTop, behavior: "auto" });

    // Virtualization renders rows based on scroll position, which may take a
    // few frames to settle. Poll for the target row and snap to it precisely.
    let attempts = 0;
    const findAndScroll = () => {
      const el = pane.querySelector(`[data-message-id="${messageId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        return;
      }
      if (attempts++ < 20) {
        window.requestAnimationFrame(findAndScroll);
      }
    };
    window.requestAnimationFrame(findAndScroll);
  }, [resetExactBottomRestoreState]);

  const handleTimelineContentHeightChange = useCallback(() => {
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) return;

    window.requestAnimationFrame(() => {
      if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) return;
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
    });
  }, [requestPinnedBottomAlignment]);

  // -- layout effects ------------------------------------------------------

  // Reset scroll state on session switch.
  useLayoutEffect(() => {
    setShowJumpToLatest(false);
    lastTranscriptMarkerRef.current = "";
    pinnedToBottomRef.current =
      lastTimelinePinnedBySessionRef.current.get(selectedSessionKey) ?? true;
    previousTimelinePaneSizeRef.current = null;
    preserveBottomOnNextPaneResizeRef.current = false;
    resetExactBottomRestoreState(selectedSessionKey || null);
    setDisableTimelineVirtualization(Boolean(selectedSessionKey));
  }, [selectedSessionKey, resetExactBottomRestoreState]);

  // Auto-scroll to bottom when transcript changes and we're pinned.
  useLayoutEffect(() => {
    if (activeView !== "threads" || activeTranscript.length === 0) return;
    if (exactBottomRestoreSessionKeyRef.current !== selectedSessionKey) return;
    if (!pinnedToBottomRef.current && !preserveBottomOnNextPaneResizeRef.current) return;

    scrollTimelineToBottom();
  }, [
    activeTranscript,
    disableTimelineVirtualization,
    scrollTimelineToBottom,
    activeView,
    selectedSessionKey,
  ]);

  // Save scroll position when leaving the threads view.
  useLayoutEffect(() => {
    if (activeView !== "threads") return undefined;

    const sessionKey = selectedSessionKey;
    const pane = timelinePaneRef.current;
    const scrollTopMap = lastTimelineScrollTopBySessionRef.current;
    const pinnedMap = lastTimelinePinnedBySessionRef.current;
    return () => {
      if (!pane) return;
      scrollTopMap.set(sessionKey, pane.scrollTop);
      pinnedMap.set(sessionKey, isNearBottom(pane));
    };
  }, [selectedSessionKey, activeView]);

  // Observe pane resize and re-align to bottom if pinned.
  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane || activeView !== "threads") {
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
      if (!previousSize || (!widthChanged && !heightChanged) || !shouldStickToBottom) return;

      stickToBottomAfterLayoutChange();
    };

    const paneRect = pane.getBoundingClientRect();
    updateMeasuredSize({ width: paneRect.width, height: paneRect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateMeasuredSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    resizeObserver.observe(pane);
    return () => {
      resizeObserver.disconnect();
      previousTimelinePaneSizeRef.current = null;
    };
  }, [requestPinnedBottomAlignment, activeView, timelinePaneMountVersion]);

  // Show "jump to latest" when new messages arrive while scrolled up.
  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) return;

    const marker = buildTranscriptChangeMarker(selectedSessionKey, activeTranscript);
    if (marker === lastTranscriptMarkerRef.current) return;
    lastTranscriptMarkerRef.current = marker;

    if (pinnedToBottomRef.current) {
      requestPinnedBottomAlignment("auto", { preferExactRestore: true });
      return;
    }

    setShowJumpToLatest(true);
  }, [activeTranscript, requestPinnedBottomAlignment, selectedSessionKey]);

  return {
    timelinePaneRef,
    setTimelinePaneElement,
    scrollTimelineToBottom,
    requestPinnedBottomAlignment,
    finalizeTimelineVirtualizationDisable,
    schedulePinnedBottomRealignment,
    handleTimelineScroll,
    jumpToLatest,
    handleTimelineContentHeightChange,
    showJumpToLatest,
    disableTimelineVirtualization,
    timelinePaneMountVersion,
    pinnedToBottomRef,
    preserveBottomOnNextPaneResizeRef,
    scrollToMessageId,
  };
}
