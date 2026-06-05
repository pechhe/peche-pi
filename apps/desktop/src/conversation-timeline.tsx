import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefCallback, type RefObject } from "react";
import type { TranscriptMessage } from "./desktop-state";
import { ThreadSearchBar } from "./thread-search";
import { TimelineItem } from "./timeline-item";
import { WorkingLabel } from "./working-label";
import { groupTranscript, type TimelineRow } from "./timeline-grouping";
import type { UndoEditOp, UndoEditsResult } from "./ipc";
import { playButtonClick } from "./button-click-sound";

const OVERSCAN_PX = 720;
const ROW_GAP_PX = 14;
const WORKING_LABEL_HEIGHT_PX = 28;
export const VIRTUALIZATION_THRESHOLD = 80;

interface ThreadSearchModel {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly search: (query: string) => void;
  readonly goToMatch: (direction: 1 | -1) => void;
  readonly close: () => void;
}

interface ConversationTimelineProps {
  readonly transcript: readonly TranscriptMessage[];
  readonly isTranscriptLoading: boolean;
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly timelinePaneElementRef?: RefCallback<HTMLDivElement>;
  readonly disableVirtualization?: boolean;
  readonly onDisableVirtualizationReady?: () => void;
  readonly onTimelineScroll: () => void;
  readonly threadSearch: ThreadSearchModel;
  readonly showJumpToLatest: boolean;
  readonly onJumpToLatest: () => void;
  readonly onContentHeightChange: () => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onUndoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly onRedoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly isRunning: boolean;
  // Label for the bottom live indicator. Defaults to "Thinking…"; the
  // new-thread placeholder passes "Preparing your thread…" so going live is a
  // label swap on the same timeline rather than a remount.
  readonly workingLabel?: string;
}

export function ConversationTimeline({
  transcript,
  isTranscriptLoading,
  timelinePaneRef,
  timelinePaneElementRef,
  disableVirtualization = false,
  onDisableVirtualizationReady,
  onTimelineScroll,
  threadSearch,
  showJumpToLatest,
  onJumpToLatest,
  onContentHeightChange,
  onViewFileInDiff,
  onUndoEdits,
  onRedoEdits,
  isRunning,
  workingLabel = "Thinking…",
}: ConversationTimelineProps) {
  // Group consecutive tool calls into bursts and extract meta events.
  // Re-runs whenever the transcript reference changes (the main process clones
  // on every push, so identity changes per event).
  const { rows: timelineRows } = useMemo(() => groupTranscript(transcript), [transcript]);

  // Giant prose blocks and attachment-heavy rows routinely blow past the estimator,
  // so keep those transcripts on the exact DOM path instead of restoring to a fake bottom.
  const hasUnreliableVirtualizedHeights = timelineRows.some(
    (item) => item.kind === "message" && (item.text.length > 2000 || Boolean(item.attachments?.length)),
  );
  // Codex-style "Thinking…" gate: show the bottom live indicator whenever
  // the run is active but there is no more-specific live output at the tail.
  // Assistant text and running tools are already visible activity; after a
  // tool finishes, bring Thinking… back so the turn never looks dead while the
  // model decides what to say/do next.
  const lastRow = timelineRows[timelineRows.length - 1];
  const lastLiveRow = (() => {
    for (let index = timelineRows.length - 1; index >= 0; index -= 1) {
      const row = timelineRows[index];
      if (row?.kind === "summary") {
        continue;
      }
      return row;
    }
    return undefined;
  })();
  const isStreamingAssistantOutput = lastLiveRow?.kind === "message" && lastLiveRow.role === "assistant";
  // A live thinking section streams its reasoning + tools inline but has no
  // header label of its own; the global braille "Thinking…" pill at the bottom
  // is the single "where the agent currently is" indicator, so we keep showing
  // it while a section is the live tail.
  const liveThinkingSectionId =
    isRunning && lastLiveRow?.kind === "thinkingSection" && lastLiveRow.trailing ? lastLiveRow.id : undefined;
  const isRunningToolAtTail =
    (lastLiveRow?.kind === "tool" && lastLiveRow.status === "running") ||
    (lastLiveRow?.kind === "toolBurst" && lastLiveRow.tools.some((tool) => tool.status === "running"));
  const showThinkingIndicator = isRunning && !isStreamingAssistantOutput && !isRunningToolAtTail;
  // While running, the trailing assistant message is the one currently being
  // streamed into. Keep rendering that message through StreamingMessageText
  // even after the run completes until the render-side typewriter has caught
  // up; otherwise the final markdown swap reveals any hidden buffered text as
  // a burst.
  const runningAssistantId =
    isRunning && lastRow && lastRow.kind === "message" && lastRow.role === "assistant"
      ? lastRow.id
      : undefined;
  const [lingeringStreamingAssistantId, setLingeringStreamingAssistantId] = useState<string | undefined>();
  useEffect(() => {
    if (runningAssistantId) {
      setLingeringStreamingAssistantId(runningAssistantId);
    }
  }, [runningAssistantId]);
  const streamingAssistantId = runningAssistantId ?? lingeringStreamingAssistantId;
  const handleStreamingCaughtUp = useCallback((messageId: string) => {
    if (runningAssistantId === messageId) {
      return;
    }
    setLingeringStreamingAssistantId((current) => (current === messageId ? undefined : current));
  }, [runningAssistantId]);
  const shouldVirtualize =
    !threadSearch.isOpen &&
    timelineRows.length > VIRTUALIZATION_THRESHOLD &&
    !disableVirtualization &&
    !hasUnreliableVirtualizedHeights;
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Set<string>>(() => new Set());
  const [expandedBurstIds, setExpandedBurstIds] = useState<Set<string>>(() => new Set());
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(() => new Set());
  // The reasoning text currently streaming in is the last reasoning child of
  // the live (trailing) thinking section.
  const streamingReasoningId = (() => {
    if (!isRunning || lastRow?.kind !== "thinkingSection" || !lastRow.trailing) {
      return undefined;
    }
    for (let k = lastRow.children.length - 1; k >= 0; k -= 1) {
      const child = lastRow.children[k];
      if (child?.kind === "reasoning") return child.id;
    }
    return undefined;
  })();
  const measuredHeightsRef = useRef(new Map<string, number>());
  const [measurementVersion, setMeasurementVersion] = useState(0);

  useLayoutEffect(() => {
    const availableToolCallIds = new Set<string>();
    const availableBurstIds = new Set<string>();
    for (const row of timelineRows) {
      if (row.kind === "tool") {
        availableToolCallIds.add(row.callId);
      } else if (row.kind === "toolBurst") {
        availableBurstIds.add(row.id);
        for (const tool of row.tools) {
          availableToolCallIds.add(tool.callId);
        }
      } else if (row.kind === "thinkingSection") {
        for (const child of row.children) {
          if (child.kind === "tool") {
            availableToolCallIds.add(child.callId);
          }
        }
      }
    }
    setExpandedToolCallIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const callId of current) {
        if (!availableToolCallIds.has(callId)) {
          changed = true;
          continue;
        }
        next.add(callId);
      }
      return changed ? next : current;
    });
    setExpandedBurstIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const burstId of current) {
        if (!availableBurstIds.has(burstId)) {
          changed = true;
          continue;
        }
        next.add(burstId);
      }
      return changed ? next : current;
    });
    const availableReasoningIds = new Set<string>();
    for (const row of timelineRows) {
      if (row.kind === "reasoning" || row.kind === "thinkingSection") {
        availableReasoningIds.add(row.id);
      }
    }
    setExpandedReasoningIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (!availableReasoningIds.has(id)) {
          changed = true;
          continue;
        }
        next.add(id);
      }
      return changed ? next : current;
    });
  }, [timelineRows]);

  useLayoutEffect(() => {
    const knownIds = new Set(timelineRows.map((item) => item.id));
    let removedAny = false;
    for (const id of measuredHeightsRef.current.keys()) {
      if (knownIds.has(id)) {
        continue;
      }
      measuredHeightsRef.current.delete(id);
      removedAny = true;
    }
    if (removedAny) {
      setMeasurementVersion((current) => current + 1);
    }
  }, [timelineRows]);

  useLayoutEffect(() => {
    if (!disableVirtualization || isTranscriptLoading || timelineRows.length === 0) {
      return;
    }
    const allRowsMeasured = timelineRows.every((item) => measuredHeightsRef.current.has(item.id));
    if (!allRowsMeasured) {
      return;
    }
    onDisableVirtualizationReady?.();
  }, [disableVirtualization, isTranscriptLoading, measurementVersion, onDisableVirtualizationReady, timelineRows]);

  const toggleToolCall = useCallback((callId: string) => {
    setExpandedToolCallIds((current) => {
      const next = new Set(current);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);

  const toggleBurst = useCallback((burstId: string) => {
    setExpandedBurstIds((current) => {
      const next = new Set(current);
      if (next.has(burstId)) {
        next.delete(burstId);
      } else {
        next.add(burstId);
      }
      return next;
    });
  }, []);

  const toggleReasoning = useCallback((reasoningId: string) => {
    setExpandedReasoningIds((current) => {
      const next = new Set(current);
      if (next.has(reasoningId)) {
        next.delete(reasoningId);
      } else {
        next.add(reasoningId);
      }
      return next;
    });
  }, []);

  const updateMeasuredHeight = useCallback((id: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height));
    const currentHeight = measuredHeightsRef.current.get(id);
    if (currentHeight === nextHeight) {
      return;
    }
    measuredHeightsRef.current.set(id, nextHeight);
    setMeasurementVersion((current) => current + 1);
  }, []);

  const assignTimelinePaneRef = useCallback((node: HTMLDivElement | null) => {
    timelinePaneRef.current = node;
    timelinePaneElementRef?.(node);
  }, [timelinePaneElementRef, timelinePaneRef]);

  return (
    <div
      className="timeline-pane timeline-pane--thread"
      data-testid="timeline-pane"
      ref={assignTimelinePaneRef}
      onScroll={onTimelineScroll}
    >
      {threadSearch.isOpen ? (
        <ThreadSearchBar
          query={threadSearch.query}
          matchCount={threadSearch.matchCount}
          activeIndex={threadSearch.activeIndex}
          inputRef={threadSearch.inputRef}
          onSearch={threadSearch.search}
          onNext={() => threadSearch.goToMatch(1)}
          onPrev={() => threadSearch.goToMatch(-1)}
          onClose={threadSearch.close}
        />
      ) : null}
      {isTranscriptLoading ? (
        <div className="timeline" data-testid="transcript" aria-hidden="true" />
      ) : timelineRows.length === 0 ? (
        <div className="timeline" data-testid="transcript">
          <div className="timeline-empty">Send a prompt to start the session.</div>
        </div>
      ) : shouldVirtualize ? (
        <VirtualizedTranscriptList
          transcript={timelineRows}
          timelinePaneRef={timelinePaneRef}
          onContentHeightChange={onContentHeightChange}
          measuredHeightsRef={measuredHeightsRef}
          measurementVersion={measurementVersion}
          expandedToolCallIds={expandedToolCallIds}
          expandedBurstIds={expandedBurstIds}
          expandedReasoningIds={expandedReasoningIds}
          onHeightChange={updateMeasuredHeight}
          onToggleToolCall={toggleToolCall}
          onToggleBurst={toggleBurst}
          onToggleReasoning={toggleReasoning}
          onViewFileInDiff={onViewFileInDiff}
          onUndoEdits={onUndoEdits}
          onRedoEdits={onRedoEdits}
          isRunning={showThinkingIndicator}
          streamingAssistantId={streamingAssistantId}
          onStreamingCaughtUp={handleStreamingCaughtUp}
          streamingReasoningId={streamingReasoningId}
          liveThinkingSectionId={liveThinkingSectionId}
          workingLabel={workingLabel}
        />
      ) : (
        <div className="timeline" data-testid="transcript">
          {timelineRows.map((item) => (
            <MeasuredTimelineItem
              item={item}
              key={item.id}
              onHeightChange={updateMeasuredHeight}
              expandedToolCallIds={expandedToolCallIds}
              expandedBurstIds={expandedBurstIds}
              expandedReasoningIds={expandedReasoningIds}
              onToggleToolCall={toggleToolCall}
              onToggleBurst={toggleBurst}
              onToggleReasoning={toggleReasoning}
              onViewFileInDiff={onViewFileInDiff}
              onUndoEdits={onUndoEdits}
              onRedoEdits={onRedoEdits}
              streamingAssistantId={streamingAssistantId}
              onStreamingCaughtUp={handleStreamingCaughtUp}
              streamingReasoningId={streamingReasoningId}
              liveThinkingSectionId={liveThinkingSectionId}
            />
          ))}
          {showThinkingIndicator ? (
            <div className="timeline-working" data-testid="timeline-working">
              <WorkingLabel label={workingLabel} />
            </div>
          ) : null}
        </div>
      )}
      {showJumpToLatest ? (
        <button className="timeline-jump" data-testid="timeline-jump" type="button" onClick={() => { playButtonClick(); onJumpToLatest(); }}>
          New activity below
        </button>
      ) : null}
    </div>
  );
}

function VirtualizedTranscriptList({
  transcript,
  timelinePaneRef,
  onContentHeightChange,
  measuredHeightsRef,
  measurementVersion,
  expandedToolCallIds,
  expandedBurstIds,
  expandedReasoningIds,
  onHeightChange,
  onToggleToolCall,
  onToggleBurst,
  onToggleReasoning,
  onViewFileInDiff,
  onUndoEdits,
  onRedoEdits,
  isRunning,
  streamingAssistantId,
  onStreamingCaughtUp,
  streamingReasoningId,
  liveThinkingSectionId,
  workingLabel,
}: {
  readonly transcript: readonly TimelineRow[];
  readonly timelinePaneRef: MutableRefObject<HTMLDivElement | null>;
  readonly onContentHeightChange: () => void;
  readonly measuredHeightsRef: MutableRefObject<Map<string, number>>;
  readonly measurementVersion: number;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly expandedBurstIds: ReadonlySet<string>;
  readonly expandedReasoningIds: ReadonlySet<string>;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onToggleBurst: (burstId: string) => void;
  readonly onToggleReasoning: (reasoningId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onUndoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly onRedoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly isRunning: boolean;
  readonly streamingAssistantId?: string;
  readonly onStreamingCaughtUp?: (messageId: string) => void;
  readonly streamingReasoningId?: string;
  readonly liveThinkingSectionId?: string;
  readonly workingLabel: string;
}) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const previousTotalHeightRef = useRef(0);
  void measurementVersion;

  useLayoutEffect(() => {
    const pane = timelinePaneRef.current;
    if (!pane) {
      return undefined;
    }

    const syncViewport = () => {
      const nextScrollTop = pane.scrollTop;
      const nextHeight = pane.clientHeight;
      setViewport((current) =>
        current.scrollTop === nextScrollTop && current.height === nextHeight
          ? current
          : { scrollTop: nextScrollTop, height: nextHeight },
      );
    };

    syncViewport();
    pane.addEventListener("scroll", syncViewport, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(pane);

    return () => {
      pane.removeEventListener("scroll", syncViewport);
      resizeObserver.disconnect();
    };
  }, [timelinePaneRef]);

  const rowHeights = transcript.map((item) => measuredHeightsRef.current.get(item.id) ?? estimateTimelineItemHeight(item));
  const rowOffsets: number[] = [];
  let totalHeight = 0;
  for (const [index, rowHeight] of rowHeights.entries()) {
    rowOffsets[index] = totalHeight;
    totalHeight += rowHeight;
    if (index < rowHeights.length - 1) {
      totalHeight += ROW_GAP_PX;
    }
  }

  useLayoutEffect(() => {
    if (previousTotalHeightRef.current === totalHeight) {
      return;
    }
    previousTotalHeightRef.current = totalHeight;
    onContentHeightChange();
  }, [onContentHeightChange, totalHeight]);

  const startOffset = Math.max(0, viewport.scrollTop - OVERSCAN_PX);
  const endOffset = viewport.scrollTop + viewport.height + OVERSCAN_PX;
  const startIndex = findStartIndex(rowOffsets, rowHeights, startOffset);
  const endIndex = findEndIndex(rowOffsets, endOffset);

  const containerHeight = totalHeight + (isRunning ? WORKING_LABEL_HEIGHT_PX : 0);

  return (
    <div className="timeline timeline--virtualized" data-testid="transcript" style={{ height: `${containerHeight}px` }}>
      {transcript.slice(startIndex, endIndex).map((item, offsetIndex) => {
        const index = startIndex + offsetIndex;
        return (
          <MeasuredTimelineItem
            item={item}
            key={item.id}
            className="timeline__virtual-row"
            top={rowOffsets[index] ?? 0}
            onHeightChange={onHeightChange}
            expandedToolCallIds={expandedToolCallIds}
            expandedBurstIds={expandedBurstIds}
            expandedReasoningIds={expandedReasoningIds}
            onToggleToolCall={onToggleToolCall}
            onToggleBurst={onToggleBurst}
            onToggleReasoning={onToggleReasoning}
            onViewFileInDiff={onViewFileInDiff}
            onUndoEdits={onUndoEdits}
            onRedoEdits={onRedoEdits}
            streamingAssistantId={streamingAssistantId}
            onStreamingCaughtUp={onStreamingCaughtUp}
            streamingReasoningId={streamingReasoningId}
            liveThinkingSectionId={liveThinkingSectionId}
          />
        );
      })}
      {isRunning ? (
        <div
          className="timeline-working timeline-working--virtualized"
          data-testid="timeline-working"
          style={{ transform: `translateY(${totalHeight}px)` }}
        >
          <WorkingLabel label={workingLabel} />
        </div>
      ) : null}
    </div>
  );
}

interface MeasuredTimelineItemProps {
  readonly item: TimelineRow;
  readonly className?: string;
  readonly top?: number;
  readonly onHeightChange: (id: string, height: number) => void;
  readonly expandedToolCallIds: ReadonlySet<string>;
  readonly expandedBurstIds: ReadonlySet<string>;
  readonly expandedReasoningIds: ReadonlySet<string>;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onToggleBurst: (burstId: string) => void;
  readonly onToggleReasoning: (reasoningId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onUndoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly onRedoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly streamingAssistantId?: string;
  readonly onStreamingCaughtUp?: (messageId: string) => void;
  readonly streamingReasoningId?: string;
  readonly liveThinkingSectionId?: string;
}

const MeasuredTimelineItem = memo(function MeasuredTimelineItem({
  item,
  className,
  top,
  onHeightChange,
  expandedToolCallIds,
  expandedBurstIds,
  expandedReasoningIds,
  onToggleToolCall,
  onToggleBurst,
  onToggleReasoning,
  onViewFileInDiff,
  onUndoEdits,
  onRedoEdits,
  streamingAssistantId,
  onStreamingCaughtUp,
  streamingReasoningId,
  liveThinkingSectionId,
}: MeasuredTimelineItemProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item.id, onHeightChange]);

  return (
    <div
      className={className}
      ref={rowRef}
      style={top == null ? undefined : { transform: `translateY(${top}px)` }}
    >
      <TimelineItem
        item={item}
        expandedToolCallIds={expandedToolCallIds}
        expandedBurstIds={expandedBurstIds}
        expandedReasoningIds={expandedReasoningIds}
        onToggleToolCall={onToggleToolCall}
        onToggleBurst={onToggleBurst}
        onToggleReasoning={onToggleReasoning}
        onViewFileInDiff={onViewFileInDiff}
        onUndoEdits={onUndoEdits}
        onRedoEdits={onRedoEdits}
        streamingAssistantId={streamingAssistantId}
        onStreamingCaughtUp={onStreamingCaughtUp}
        streamingReasoningId={streamingReasoningId}
        liveThinkingSectionId={liveThinkingSectionId}
      />
    </div>
  );
}, sameMeasuredTimelineItemProps);

function rowSignature(item: TimelineRow): string {
  if (item.kind === "message") {
    const attachmentSignature = item.attachments?.map((attachment) => `${attachment.kind}:${attachment.name}`).join(",") ?? "";
    return `${item.kind}:${item.id}:${item.role}:${item.text}:${attachmentSignature}`;
  }
  if (item.kind === "tool") {
    return `${item.kind}:${item.id}:${item.callId}:${item.toolName}:${item.status}:${item.label}:${item.detail ?? ""}`;
  }
  if (item.kind === "toolBurst") {
    return `${item.kind}:${item.id}:${item.trailing}:${item.tools.map((tool) => `${tool.callId}:${tool.status}:${tool.label}:${tool.detail ?? ""}`).join("|")}`;
  }
  if (item.kind === "thinkingSection") {
    return `${item.kind}:${item.id}:${item.trailing}:${item.children.map((child) => child.kind === "reasoning" ? `${child.id}:${child.text}` : `${child.callId}:${child.status}:${child.label}:${child.detail ?? ""}`).join("|")}`;
  }
  if (item.kind === "editedFiles") {
    return `${item.kind}:${item.id}:${item.tools.map((tool) => `${tool.callId}:${tool.status}:${tool.label}:${tool.detail ?? ""}`).join("|")}`;
  }
  if (item.kind === "activity") {
    return `${item.kind}:${item.id}:${item.label}:${item.detail ?? ""}:${item.metadata ?? ""}:${item.tone ?? ""}`;
  }
  if (item.kind === "summary") {
    return `${item.kind}:${item.id}:${item.label}:${item.metadata ?? ""}:${item.presentation ?? ""}`;
  }
  if (item.kind === "reasoning") {
    return `${item.kind}:${item.id}:${item.text}`;
  }
  return "";
}

function rowContainsId(item: TimelineRow, id: string | undefined): boolean {
  if (!id) {
    return false;
  }
  if (item.id === id) {
    return true;
  }
  if (item.kind === "thinkingSection") {
    return item.children.some((child) => child.id === id);
  }
  if (item.kind === "toolBurst" || item.kind === "editedFiles") {
    return item.tools.some((tool) => tool.id === id || tool.callId === id);
  }
  if (item.kind === "tool") {
    return item.callId === id;
  }
  return false;
}

function rowExpandedState(
  item: TimelineRow,
  expandedToolCallIds: ReadonlySet<string>,
  expandedBurstIds: ReadonlySet<string>,
  expandedReasoningIds: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  if (item.kind === "tool") {
    parts.push(`tool:${expandedToolCallIds.has(item.callId)}`);
  } else if (item.kind === "toolBurst") {
    parts.push(`burst:${expandedBurstIds.has(item.id)}`);
    for (const tool of item.tools) {
      parts.push(`tool:${tool.callId}:${expandedToolCallIds.has(tool.callId)}`);
    }
  } else if (item.kind === "thinkingSection") {
    parts.push(`reasoning:${item.id}:${expandedReasoningIds.has(item.id)}`);
    for (const child of item.children) {
      if (child.kind === "tool") {
        parts.push(`tool:${child.callId}:${expandedToolCallIds.has(child.callId)}`);
      } else {
        parts.push(`reasoning:${child.id}:${expandedReasoningIds.has(child.id)}`);
      }
    }
  } else if (item.kind === "reasoning") {
    parts.push(`reasoning:${item.id}:${expandedReasoningIds.has(item.id)}`);
  }
  return parts.join("|");
}

function sameMeasuredTimelineItemProps(
  previous: MeasuredTimelineItemProps,
  next: MeasuredTimelineItemProps,
): boolean {
  if (
    previous.className !== next.className ||
    previous.top !== next.top ||
    previous.onHeightChange !== next.onHeightChange ||
    previous.onToggleToolCall !== next.onToggleToolCall ||
    previous.onToggleBurst !== next.onToggleBurst ||
    previous.onToggleReasoning !== next.onToggleReasoning ||
    previous.onViewFileInDiff !== next.onViewFileInDiff ||
    previous.onUndoEdits !== next.onUndoEdits ||
    previous.onRedoEdits !== next.onRedoEdits ||
    previous.onStreamingCaughtUp !== next.onStreamingCaughtUp
  ) {
    return false;
  }
  if (rowSignature(previous.item) !== rowSignature(next.item)) {
    return false;
  }
  if (
    rowExpandedState(previous.item, previous.expandedToolCallIds, previous.expandedBurstIds, previous.expandedReasoningIds) !==
    rowExpandedState(next.item, next.expandedToolCallIds, next.expandedBurstIds, next.expandedReasoningIds)
  ) {
    return false;
  }
  const streamingIds = [
    previous.streamingAssistantId,
    next.streamingAssistantId,
    previous.streamingReasoningId,
    next.streamingReasoningId,
    previous.liveThinkingSectionId,
    next.liveThinkingSectionId,
  ];
  return streamingIds.every((id) => !rowContainsId(previous.item, id) && !rowContainsId(next.item, id));
}

function findStartIndex(offsets: readonly number[], heights: readonly number[], targetOffset: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const end = (offsets[mid] ?? 0) + (heights[mid] ?? 0);
    if (end < targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, Math.min(offsets.length - 1, low));
}

function findEndIndex(offsets: readonly number[], targetOffset: number): number {
  if (offsets.length === 0) {
    return 0;
  }

  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((offsets[mid] ?? 0) <= targetOffset) {
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  const lastVisibleIndex = Math.max(0, low);
  return Math.min(offsets.length, Math.max(lastVisibleIndex + 1, 1));
}

function estimateTimelineItemHeight(item: TimelineRow): number {
  if (item.kind === "message") {
    const attachmentHeight = item.attachments?.some((attachment) => attachment.kind === "image")
      ? 120
      : item.attachments?.length
        ? 56
        : 0;
    const textLength = Math.max(item.text.length, 1);
    return 48 + attachmentHeight + Math.min(240, Math.ceil(textLength / 90) * 20);
  }
  if (item.kind === "tool") {
    return 52;
  }
  if (item.kind === "toolBurst") {
    return 38;
  }
  if (item.kind === "summary") {
    return item.presentation === "divider" ? 44 : 38;
  }
  if (item.kind === "reasoning") {
    return 32;
  }
  if (item.kind === "thinkingSection") {
    // Live/expanded sections are tall; the ResizeObserver corrects the real
    // height once mounted, so this is just a first-paint placeholder.
    return item.trailing ? 120 : 32;
  }
  if (item.kind === "editedFiles") {
    return 24 + item.tools.length * 28;
  }
  return 38;
}
