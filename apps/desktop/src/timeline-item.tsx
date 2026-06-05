import { memo, useEffect, useState } from "react";
import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineReasoning, TimelineToolCall, TimelineSummary } from "./timeline-types";
import type { TimelineEditedFiles, TimelineThinkingSection } from "./timeline-model";
import type { UndoEditOp, UndoEditReplacement, UndoEditsResult } from "./ipc";
import type { TimelineRow, TimelineToolBurst } from "./timeline-grouping";
import { summariseToolBurst } from "./timeline-grouping";
import { MessageMarkdown, StreamingMessageText } from "./message-markdown";
import { InlineDiff, extractDiffFromOutput } from "./diff-inline";
import { ChevronRightIcon, CopyIcon, DiffIcon, EditedFilesIcon, FileIcon, FolderIcon, TerminalIcon } from "./icons";
import { openImageLightbox } from "./image-lightbox";
import { extensionToLanguage } from "./syntax-highlight";
import { PLAN_MODE_PROMPT_SEPARATOR } from "./composer-mode";
import { SubagentToolCard, isSubagentTool } from "./subagent-card";

// Tracks user-message ids whose entrance animation has already played. The
// createdAt gate suppresses animation when an existing transcript is loaded for
// the first time; the Set prevents virtualised remounts from replaying it.
const animatedUserMessageIds = new Set<string>();
const USER_BUBBLE_ANIMATION_MS = 520;

/**
 * Mark user-message ids as already-animated so their bubble does not replay the
 * send animation on its next mount. Used when a thread transitions from the
 * "Preparing your thread…" placeholder to the live session: the send animation
 * already played on the placeholder, so the live bubble must appear in place.
 */
export function markUserMessagesAnimated(ids: Iterable<string>): void {
  for (const id of ids) {
    animatedUserMessageIds.add(id);
  }
}

function isFreshUserBubble(item: SessionTranscriptMessage): boolean {
  if (animatedUserMessageIds.has(item.id)) {
    return false;
  }
  const createdAt = Date.parse(item.createdAt);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  return Date.now() - createdAt < 1500;
}

export const TimelineItem = memo(function TimelineItem({
  item,
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
}: {
  readonly item: TimelineRow;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly expandedBurstIds?: ReadonlySet<string>;
  readonly expandedReasoningIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onToggleBurst?: (burstId: string) => void;
  readonly onToggleReasoning?: (reasoningId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onUndoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly onRedoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly streamingAssistantId?: string;
  readonly onStreamingCaughtUp?: (messageId: string) => void;
  readonly streamingReasoningId?: string;
  readonly liveThinkingSectionId?: string;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} streamingAssistantId={streamingAssistantId} onStreamingCaughtUp={onStreamingCaughtUp} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "thinkingSection":
      return (
        <TimelineThinkingSectionItem
          item={item}
          isLive={liveThinkingSectionId === item.id}
          expanded={expandedReasoningIds?.has(item.id) ?? false}
          onToggle={onToggleReasoning}
          expandedToolCallIds={expandedToolCallIds}
          onToggleToolCall={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
          streamingReasoningId={streamingReasoningId}
        />
      );
    case "reasoning":
      return (
        <TimelineReasoningItem
          item={item}
          expanded={expandedReasoningIds?.has(item.id) ?? false}
          onToggle={onToggleReasoning}
          isStreaming={streamingReasoningId === item.id}
        />
      );
    case "tool":
      if (isSubagentTool(item.toolName)) {
        return <SubagentToolCard item={item} />;
      }
      return (
        <TimelineToolCallItem
          item={item}
          expanded={expandedToolCallIds?.has(item.callId) ?? false}
          onToggle={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
        />
      );
    case "toolBurst":
      return (
        <TimelineToolBurstItem
          item={item}
          expanded={expandedBurstIds?.has(item.id) ?? false}
          onToggle={onToggleBurst}
          expandedToolCallIds={expandedToolCallIds}
          onToggleToolCall={onToggleToolCall}
          onViewFileInDiff={onViewFileInDiff}
        />
      );
    case "editedFiles":
      return <TimelineEditedFilesItem item={item} onViewFileInDiff={onViewFileInDiff} onUndoEdits={onUndoEdits} onRedoEdits={onRedoEdits} />;
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}, (prev, next) => {
  // The main process re-clones every transcript message before pushing to
  // the renderer, so identity comparison is useless. Compare the fields that
  // actually affect rendering for each item kind, and the tool-row expansion.
  if (prev.onToggleToolCall !== next.onToggleToolCall) return false;
  if (prev.onToggleBurst !== next.onToggleBurst) return false;
  if (prev.onToggleReasoning !== next.onToggleReasoning) return false;
  if (prev.onViewFileInDiff !== next.onViewFileInDiff) return false;
  if (prev.onUndoEdits !== next.onUndoEdits) return false;
  if (prev.onRedoEdits !== next.onRedoEdits) return false;
  if (prev.onStreamingCaughtUp !== next.onStreamingCaughtUp) return false;
  if (prev.item.kind === "reasoning" && next.item.kind === "reasoning") {
    const prevExpanded = prev.expandedReasoningIds?.has(prev.item.id) ?? false;
    const nextExpanded = next.expandedReasoningIds?.has(next.item.id) ?? false;
    if (prevExpanded !== nextExpanded) return false;
    const prevStreaming = prev.streamingReasoningId === prev.item.id;
    const nextStreaming = next.streamingReasoningId === next.item.id;
    if (prevStreaming !== nextStreaming) return false;
  }
  if (prev.item.kind === "thinkingSection" && next.item.kind === "thinkingSection") {
    const prevLive = prev.liveThinkingSectionId === prev.item.id;
    const nextLive = next.liveThinkingSectionId === next.item.id;
    if (prevLive !== nextLive) return false;
    const prevExpanded = prev.expandedReasoningIds?.has(prev.item.id) ?? false;
    const nextExpanded = next.expandedReasoningIds?.has(next.item.id) ?? false;
    if (prevExpanded !== nextExpanded) return false;
    // While live, the section streams reasoning text and tool status changes,
    // so it must re-render on any child change.
    if (nextLive) return false;
    if (prevExpanded || nextExpanded) {
      for (const child of next.item.children) {
        if (child.kind !== "tool") continue;
        const pe = prev.expandedToolCallIds?.has(child.callId) ?? false;
        const ne = next.expandedToolCallIds?.has(child.callId) ?? false;
        if (pe !== ne) return false;
      }
    }
  }
  // Re-render this row when streaming status flips for THIS row (so the
  // assistant message swaps from StreamingMessageText to MessageMarkdown at
  // run end, and vice versa). Comparing the raw id across all rows would
  // invalidate every row on every delta — only matters for the row whose id
  // is becoming / ceasing to be the streaming target.
  if (prev.item.kind === "message" && next.item.kind === "message" && prev.item.role === "assistant") {
    const prevStreaming = prev.streamingAssistantId === prev.item.id;
    const nextStreaming = next.streamingAssistantId === next.item.id;
    if (prevStreaming !== nextStreaming) return false;
  }
  if (!isSameTimelineItem(prev.item, next.item)) return false;
  if (prev.item.kind === "tool" && next.item.kind === "tool") {
    const callId = prev.item.callId;
    const prevExpanded = prev.expandedToolCallIds?.has(callId) ?? false;
    const nextExpanded = next.expandedToolCallIds?.has(callId) ?? false;
    if (prevExpanded !== nextExpanded) return false;
  }
  if (prev.item.kind === "toolBurst" && next.item.kind === "toolBurst") {
    const prevExpanded = prev.expandedBurstIds?.has(prev.item.id) ?? false;
    const nextExpanded = next.expandedBurstIds?.has(next.item.id) ?? false;
    if (prevExpanded !== nextExpanded) return false;
    // When expanded, individual tool expansion state may also change.
    if (prevExpanded) {
      for (const tool of prev.item.tools) {
        const pe = prev.expandedToolCallIds?.has(tool.callId) ?? false;
        const ne = next.expandedToolCallIds?.has(tool.callId) ?? false;
        if (pe !== ne) return false;
      }
    }
  }
  return true;
});

function isSameTimelineItem(a: TimelineRow, b: TimelineRow): boolean {
  if (a.id !== b.id || a.kind !== b.kind) return false;
  if (a.kind === "toolBurst" && b.kind === "toolBurst") {
    if (a.tools.length !== b.tools.length) return false;
    for (let idx = 0; idx < a.tools.length; idx += 1) {
      const ta = a.tools[idx]!;
      const tb = b.tools[idx]!;
      if (ta.callId !== tb.callId || ta.status !== tb.status || ta.toolName !== tb.toolName) {
        return false;
      }
    }
    return true;
  }
  if (a.kind === "message" && b.kind === "message") {
    return (
      a.text === b.text &&
      a.role === b.role &&
      (a.attachments?.length ?? 0) === (b.attachments?.length ?? 0)
    );
  }
  if (a.kind === "tool" && b.kind === "tool") {
    // input/output are cloned objects across publishes; comparing by reference is
    // useless and deep equality is too expensive. Once a tool reaches a terminal
    // status its content is immutable, so status + identity is sufficient.
    return (
      a.callId === b.callId &&
      a.toolName === b.toolName &&
      a.status === b.status &&
      a.label === b.label &&
      a.status !== "running"
    );
  }
  if (a.kind === "activity" && b.kind === "activity") {
    return a.label === b.label && a.detail === b.detail && a.metadata === b.metadata && a.tone === b.tone;
  }
  if (a.kind === "summary" && b.kind === "summary") {
    return a.label === b.label && a.metadata === b.metadata && a.presentation === b.presentation;
  }
  if (a.kind === "reasoning" && b.kind === "reasoning") {
    return a.text === b.text;
  }
  if (a.kind === "editedFiles" && b.kind === "editedFiles") {
    if (a.tools.length !== b.tools.length) return false;
    for (let idx = 0; idx < a.tools.length; idx += 1) {
      if (a.tools[idx]!.id !== b.tools[idx]!.id) return false;
    }
    return true;
  }
  if (a.kind === "thinkingSection" && b.kind === "thinkingSection") {
    if (a.trailing !== b.trailing) return false;
    if (a.children.length !== b.children.length) return false;
    for (let idx = 0; idx < a.children.length; idx += 1) {
      const ca = a.children[idx]!;
      const cb = b.children[idx]!;
      if (ca.kind !== cb.kind || ca.id !== cb.id) return false;
      if (ca.kind === "reasoning" && cb.kind === "reasoning" && ca.text !== cb.text) return false;
      if (ca.kind === "tool" && cb.kind === "tool" && ca.status !== cb.status) return false;
    }
    return true;
  }
  return true;
}

function TimelineReasoningItem({
  item,
  expanded,
  onToggle,
  isStreaming,
}: {
  readonly item: TimelineReasoning;
  readonly expanded: boolean;
  readonly onToggle?: (reasoningId: string) => void;
  readonly isStreaming: boolean;
}) {
  const headerLabel = isStreaming ? "Thinking" : "Thought";
  return (
    <article className={`timeline-reasoning${isStreaming ? " timeline-reasoning--streaming" : ""}`}>
      <button
        className="timeline-reasoning__header"
        type="button"
        aria-expanded={expanded}
        data-testid="timeline-reasoning"
        onClick={() => onToggle?.(item.id)}
      >
        <span className={`timeline-reasoning__chevron ${expanded ? "timeline-reasoning__chevron--expanded" : ""}`}>
          <ChevronRightIcon />
        </span>
        <span className="timeline-reasoning__label">{headerLabel}</span>
      </button>
      {expanded ? (
        <div className="timeline-reasoning__body">
          {isStreaming ? <StreamingMessageText text={item.text} /> : <MessageMarkdown text={item.text} />}
        </div>
      ) : null}
    </article>
  );
}

function TimelineThinkingSectionItem({
  item,
  isLive,
  expanded,
  onToggle,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
  streamingReasoningId,
}: {
  readonly item: TimelineThinkingSection;
  readonly isLive: boolean;
  readonly expanded: boolean;
  readonly onToggle?: (id: string) => void;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly streamingReasoningId?: string;
}) {
  // While the run is the live tail, the section streams its content with no
  // header label — the global braille "Thinking…" pill at the bottom of the
  // timeline is the single "where the agent currently is" indicator. Once an
  // answer follows, the section collapses into a "Thought for Ns" disclosure
  // the user can re-open.
  const isOpen = isLive || expanded;
  // Keep the body mounted for the duration of the collapse animation so the
  // grid-rows transition can actually run, then unmount it so collapsed
  // history sections don't keep heavy reasoning markdown in the DOM.
  const [renderBody, setRenderBody] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setRenderBody(true);
      return undefined;
    }
    const timeout = window.setTimeout(() => setRenderBody(false), THINKING_COLLAPSE_MS);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);
  const duration = formatThinkDuration(item.children);
  const headerLabel = duration ? `Thought for ${duration}` : "Thought";
  return (
    <article className={`timeline-thinking${isLive ? " timeline-thinking--live" : ""}`} data-testid="timeline-thinking">
      {isLive ? null : (
        <button
          className="timeline-thinking__header"
          type="button"
          aria-expanded={isOpen}
          data-testid="timeline-thinking-toggle"
          onClick={() => onToggle?.(item.id)}
        >
          <span className={`timeline-thinking__chevron ${isOpen ? "timeline-thinking__chevron--expanded" : ""}`}>
            <ChevronRightIcon />
          </span>
          <span className="timeline-thinking__label">{headerLabel}</span>
        </button>
      )}
      <div className="timeline-thinking__collapse" data-open={isOpen} aria-hidden={!isOpen}>
        <div className="timeline-thinking__collapse-inner">
          {renderBody ? (
            <div className="timeline-thinking__body">
              {item.children.map((child) =>
                child.kind === "reasoning" ? (
                  <TimelineThinkingReasoningChild
                    key={child.id}
                    item={child}
                    isStreaming={streamingReasoningId === child.id}
                  />
                ) : (
                  <TimelineThinkingToolChild
                    key={child.id}
                    item={child}
                    expanded={expandedToolCallIds?.has(child.callId) ?? false}
                    onToggle={onToggleToolCall}
                    onViewFileInDiff={onViewFileInDiff}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const TimelineThinkingReasoningChild = memo(function TimelineThinkingReasoningChild({
  item,
  isStreaming,
}: {
  readonly item: TimelineReasoning;
  readonly isStreaming: boolean;
}) {
  return (
    <div className={`timeline-thinking__reasoning${isStreaming ? " timeline-thinking__reasoning--streaming" : ""}`}>
      {isStreaming ? <StreamingMessageText text={item.text} /> : <MessageMarkdown text={item.text} />}
    </div>
  );
}, (prev, next) => prev.item.id === next.item.id && prev.item.text === next.item.text && prev.isStreaming === next.isStreaming);

const TimelineThinkingToolChild = memo(function TimelineThinkingToolChild({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  return (
    <TimelineToolCallItem
      item={item}
      expanded={expanded}
      onToggle={onToggle}
      onViewFileInDiff={onViewFileInDiff}
    />
  );
}, (prev, next) => (
  prev.item.callId === next.item.callId &&
  prev.item.toolName === next.item.toolName &&
  prev.item.status === next.item.status &&
  prev.item.label === next.item.label &&
  prev.expanded === next.expanded &&
  prev.onToggle === next.onToggle &&
  prev.onViewFileInDiff === next.onViewFileInDiff &&
  prev.item.status !== "running"
));

// Keep in sync with the grid-rows transition duration in main.css.
const THINKING_COLLAPSE_MS = 260;

function formatThinkDuration(children: TimelineThinkingSection["children"]): string {
  const times = children
    .map((child) => Date.parse(child.createdAt))
    .filter((value) => !Number.isNaN(value));
  if (times.length < 2) return "";
  const seconds = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

interface EditedFileEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

function aggregateEditedFiles(tools: TimelineEditedFiles["tools"]): EditedFileEntry[] {
  const byPath = new Map<string, { added: number; removed: number }>();
  const order: string[] = [];
  for (const tool of tools) {
    const path = extractFilename(tool.input);
    if (!path) continue;
    const diff = extractDiffFromOutput(tool.output) ?? extractDiffFromOutput(tool.input);
    const stats = diff ? countDiffStats(diff) : { added: 0, removed: 0 };
    const current = byPath.get(path);
    if (current) {
      current.added += stats.added;
      current.removed += stats.removed;
    } else {
      byPath.set(path, { added: stats.added, removed: stats.removed });
      order.push(path);
    }
  }
  return order.map((path) => ({ path, ...byPath.get(path)! }));
}

function parseUndoReplacements(input: unknown): UndoEditReplacement[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  const out: UndoEditReplacement[] = [];
  if (Array.isArray(record.edits)) {
    for (const entry of record.edits) {
      if (entry && typeof entry === "object") {
        const { oldText, newText } = entry as Record<string, unknown>;
        if (typeof oldText === "string" && typeof newText === "string") {
          out.push({ oldText, newText });
        }
      }
    }
  } else if (typeof record.oldText === "string" && typeof record.newText === "string") {
    out.push({ oldText: record.oldText, newText: record.newText });
  }
  return out;
}

function buildUndoOps(tools: TimelineEditedFiles["tools"]): UndoEditOp[] {
  const ops: UndoEditOp[] = [];
  for (const tool of tools) {
    const path = extractFilename(tool.input);
    if (!path) continue;
    const replacements = parseUndoReplacements(tool.input);
    if (replacements.length > 0) {
      ops.push({ kind: "edit", path, replacements });
    } else {
      // Full-file write (or unknown shape): the main process undoes it only
      // when the file is untracked (created this turn).
      ops.push({ kind: "write", path });
    }
  }
  return ops;
}

function TimelineEditedFilesItem({
  item,
  onViewFileInDiff,
  onUndoEdits,
  onRedoEdits,
}: {
  readonly item: TimelineEditedFiles;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onUndoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly onRedoEdits?: (ops: readonly UndoEditOp[]) => Promise<UndoEditsResult>;
}) {
  const [undoState, setUndoState] = useState<"idle" | "undoing" | "undone" | "redoing" | "error">("idle");
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const files = aggregateEditedFiles(item.tools);
  if (files.length === 0) {
    return null;
  }
  const multiple = files.length > 1;
  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
  const reviewPath = files[0]!.path;
  const undone = undoState === "undone" || undoState === "redoing";

  const handleUndo = async () => {
    if (!onUndoEdits || undoState === "undoing" || undoState === "redoing") return;
    setUndoState("undoing");
    setUndoNote(null);
    try {
      const result = await onUndoEdits(buildUndoOps(item.tools));
      if (result.reverted.length === 0) {
        setUndoState("error");
        setUndoNote(result.failed[0]?.reason ?? "Nothing could be undone.");
        return;
      }
      setUndoState("undone");
      setUndoNote(result.failed.length > 0 ? `Couldn't undo ${result.failed.length} file${result.failed.length === 1 ? "" : "s"}.` : null);
    } catch (error) {
      setUndoState("error");
      setUndoNote(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRedo = async () => {
    if (!onRedoEdits || undoState === "undoing" || undoState === "redoing") return;
    setUndoState("redoing");
    setUndoNote(null);
    try {
      const result = await onRedoEdits(buildUndoOps(item.tools));
      if (result.reverted.length === 0) {
        setUndoState("undone");
        setUndoNote(result.failed[0]?.reason ?? "Nothing could be redone.");
        return;
      }
      setUndoState("idle");
      setUndoNote(result.failed.length > 0 ? `Couldn't redo ${result.failed.length} file${result.failed.length === 1 ? "" : "s"}.` : null);
    } catch (error) {
      setUndoState("undone");
      setUndoNote(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <article
      className={`timeline-edited-files${undone ? " timeline-edited-files--undone" : ""}`}
      data-testid="timeline-edited-files"
    >
      <div className="timeline-edited-files__header">
        <span className="timeline-edited-files__icon" aria-hidden="true">
          <EditedFilesIcon />
        </span>
        <div className="timeline-edited-files__heading">
          <span className="timeline-edited-files__title">
            {undone
              ? multiple
                ? `Reverted ${files.length} files`
                : `Reverted ${shortenPath(reviewPath)}`
              : multiple
                ? `Edited ${files.length} files`
                : `Edited ${shortenPath(reviewPath)}`}
          </span>
          <span className="timeline-edited-files__stats">
            <span className="timeline-tool__stat-add">{`+${totalAdded}`}</span>{" "}
            <span className="timeline-tool__stat-del">{`-${totalRemoved}`}</span>
          </span>
        </div>
        <div className="timeline-edited-files__actions">
          {undoNote ? <span className="timeline-edited-files__note">{undoNote}</span> : null}
          {onUndoEdits && !undone ? (
            <button
              aria-label="Undo edits"
              className="timeline-edited-files__undo"
              data-testid="timeline-edited-files-undo"
              type="button"
              disabled={undoState === "undoing"}
              onClick={handleUndo}
            >
              {undoState === "undoing" ? "Undoing…" : "Undo"}
            </button>
          ) : null}
          {onRedoEdits && undone ? (
            <button
              aria-label="Redo edits"
              className="timeline-edited-files__undo"
              data-testid="timeline-edited-files-redo"
              type="button"
              disabled={undoState === "redoing"}
              onClick={handleRedo}
            >
              {undoState === "redoing" ? "Redoing…" : "Redo"}
            </button>
          ) : null}
          {onViewFileInDiff ? (
            <button
              aria-label="Review changes"
              className="timeline-edited-files__review"
              data-testid="timeline-edited-files-review"
              type="button"
              onClick={() => onViewFileInDiff(reviewPath)}
            >
              Review
            </button>
          ) : null}
        </div>
      </div>
      {multiple ? (
        <div className="timeline-edited-files__list">
          {files.map((file) => (
            <button
              className="timeline-edited-files__row"
              key={file.path}
              type="button"
              data-testid="timeline-edited-files-row"
              aria-label={`View ${file.path} in changes`}
              disabled={!onViewFileInDiff}
              onClick={onViewFileInDiff ? () => onViewFileInDiff(file.path) : undefined}
            >
              <span className="timeline-edited-files__path">{shortenPath(file.path)}</span>
              <span className="timeline-edited-files__stats">
                <span className="timeline-tool__stat-add">{`+${file.added}`}</span>{" "}
                <span className="timeline-tool__stat-del">{`-${file.removed}`}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TimelineMessage({
  item,
  streamingAssistantId,
  onStreamingCaughtUp,
}: {
  readonly item: SessionTranscriptMessage;
  readonly streamingAssistantId?: string;
  readonly onStreamingCaughtUp?: (messageId: string) => void;
}) {
  if (item.role === "user") {
    return <UserTimelineMessage item={item} />;
  }

  if (item.role === "branchSummary" || item.role === "compactionSummary") {
    return (
      <article className="timeline-item timeline-item--summary-card">
        <div className="timeline-item__summary-eyebrow">
          {item.role === "branchSummary" ? "Branch summary" : "Compaction summary"}
        </div>
        <MessageMarkdown text={item.text} />
      </article>
    );
  }

  const isStreaming = item.id === streamingAssistantId;
  return (
    <article className="timeline-item timeline-item--assistant">
      {isStreaming ? <StreamingMessageText text={item.text} onCaughtUp={() => onStreamingCaughtUp?.(item.id)} /> : <MessageMarkdown text={item.text} />}
    </article>
  );
}

function splitPlanModePrompt(text: string): { instructions: string; prompt: string } | undefined {
  const separatorIndex = text.indexOf(PLAN_MODE_PROMPT_SEPARATOR);
  if (separatorIndex === -1) return undefined;
  const instructions = text.slice(0, separatorIndex).trim();
  const prompt = text.slice(separatorIndex + PLAN_MODE_PROMPT_SEPARATOR.length).trim();
  return { instructions, prompt };
}

function UserTimelineMessage({ item }: { readonly item: SessionTranscriptMessage }) {
  const [justSent, setJustSent] = useState(() => isFreshUserBubble(item));
  const [planInstructionsExpanded, setPlanInstructionsExpanded] = useState(false);
  const planPrompt = splitPlanModePrompt(item.text);

  useEffect(() => {
    if (!justSent) return;
    const timeout = window.setTimeout(() => {
      animatedUserMessageIds.add(item.id);
      setJustSent(false);
    }, USER_BUBBLE_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [item.id, justSent]);

  return (
    <article className={`timeline-item timeline-item--user${justSent ? " timeline-item--just-sent" : ""}`}>
      <div className="timeline-item__bubble">
        {item.attachments?.length ? (
          <div className="timeline-item__attachments">
            {item.attachments.map((attachment, index) =>
              attachment.kind === "image" ? (
                (() => {
                  const src = `data:${attachment.mimeType};base64,${attachment.data}`;
                  const alt = attachment.name ?? `Attachment ${index + 1}`;
                  return (
                    <button
                      type="button"
                      className="timeline-item__attachment-button"
                      key={`${item.id}:${index}`}
                      onClick={() => openImageLightbox({ src, alt })}
                      aria-label={`View ${alt}`}
                    >
                      <img
                        alt={alt}
                        className="timeline-item__attachment timeline-item__attachment--image"
                        src={src}
                      />
                    </button>
                  );
                })()
              ) : (
                <div
                  className="timeline-item__attachment timeline-item__attachment--file"
                  key={`${item.id}:${index}`}
                  title={attachment.fsPath}
                >
                  <span className="timeline-item__attachment-icon" aria-hidden="true">
                    <FileIcon />
                  </span>
                  <span className="timeline-item__attachment-name">{attachment.name}</span>
                </div>
              ),
            )}
          </div>
        ) : null}
        {planPrompt ? (
          <>
            <div className="timeline-plan-prompt">
              <button
                type="button"
                className="timeline-plan-prompt__header"
                onClick={() => setPlanInstructionsExpanded((expanded) => !expanded)}
                aria-expanded={planInstructionsExpanded}
              >
                <span
                  className={`timeline-plan-prompt__chevron${planInstructionsExpanded ? " timeline-plan-prompt__chevron--expanded" : ""}`}
                  aria-hidden="true"
                >
                  <ChevronRightIcon />
                </span>
                <span>Plan mode instructions</span>
              </button>
              {planInstructionsExpanded ? (
                <div className="timeline-plan-prompt__body">
                  <MessageMarkdown text={planPrompt.instructions} />
                </div>
              ) : null}
            </div>
            <MessageMarkdown text={planPrompt.prompt} />
          </>
        ) : (
          <MessageMarkdown text={item.text} />
        )}
      </div>
    </article>
  );
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"}`}>
      <span className="timeline-activity__label">{item.label}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}

function TimelineToolCallItem({
  item,
  expanded,
  onToggle,
  onViewFileInDiff,
}: {
  readonly item: TimelineToolCall;
  readonly expanded: boolean;
  readonly onToggle?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const hasContent = item.input !== undefined || item.output !== undefined;
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) ?? extractDiffFromOutput(item.input) : undefined;
  const diffStats = diffText ? countDiffStats(diffText) : undefined;
  const compactLabel = buildCompactLabel(item, diffStats);
  const filePath = isWriteTool(item.toolName) ? extractFilename(item.input) || undefined : undefined;
  const diffLanguage = diffText && filePath ? extensionToLanguage(filePath) : undefined;

  const handleCopy = () => {
    const text = diffText ?? formatToolContent(item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <div className="timeline-tool__header-row">
        <button
          className="timeline-tool__header"
          type="button"
          aria-expanded={expanded}
          disabled={!hasContent}
          onClick={() => onToggle?.(item.callId)}
        >
          {hasContent ? (
            <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
              <ChevronRightIcon />
            </span>
          ) : null}
          <span className="timeline-tool__icon" aria-hidden="true">{toolIcon(item)}</span>
          <span className="timeline-tool__label">{compactLabel}</span>
          {diffStats ? (
            <span className="timeline-tool__diff-stats">
              <span className="timeline-tool__stat-add">+{diffStats.added}</span>
              {" "}
              <span className="timeline-tool__stat-del">-{diffStats.removed}</span>
            </span>
          ) : null}
          <span className="timeline-tool__meta-inline">{`${item.toolName} \u00b7 ${statusLabel(item.status)}`}</span>
        </button>
        {filePath && onViewFileInDiff ? (
          <button
            aria-label={`View ${filePath} in changes`}
            className="icon-button timeline-tool__view-in-diff"
            data-testid="timeline-tool-view-in-diff"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onViewFileInDiff(filePath);
            }}
          >
            <DiffIcon />
          </button>
        ) : null}
      </div>
      {expanded && hasContent ? (
        <div className="timeline-tool__body">
          {diffText ? (
            <>
              <div className="timeline-tool__diff-header">
                <span className="timeline-tool__diff-filename">
                  {extractFilename(item.input)}
                  {diffStats ? (
                    <span className="timeline-tool__diff-stats">
                      {" "}<span className="timeline-tool__stat-add">+{diffStats.added}</span>
                      {" "}<span className="timeline-tool__stat-del">-{diffStats.removed}</span>
                    </span>
                  ) : null}
                </span>
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <InlineDiff diff={diffText} language={diffLanguage} />
            </>
          ) : (
            <>
              <div className="timeline-tool__body-actions">
                <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
                  <CopyIcon />
                </button>
              </div>
              <pre className="timeline-tool__pre">{formatToolContent(item.input, item.output)}</pre>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function toolIcon(item: TimelineToolCall) {
  if (/read|open/i.test(item.toolName)) {
    return <FileIcon />;
  }
  if (/glob|ls|list|find/i.test(item.toolName)) {
    return <FolderIcon />;
  }
  return <TerminalIcon />;
}

function buildCompactLabel(item: TimelineToolCall, _diffStats: { added: number; removed: number } | undefined): string {
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return `${item.status === "running" ? "Editing" : "Edited"} ${shortenPath(filename)}`;
    }
  }
  return item.label;
}

function extractFilename(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
    if (typeof path === "string") {
      return path;
    }
  }
  return "";
}

function shortenPath(filePath: string): string {
  // Show last 2-3 path segments for readability
  const parts = filePath.split("/");
  if (parts.length <= 3) {
    return filePath;
  }
  return parts.slice(-3).join("/");
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(typeof input === "string" ? input : JSON.stringify(input, null, 2));
  }
  if (output !== undefined) {
    parts.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  }
  return parts.join("\n\n");
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function TimelineToolBurstItem({
  item,
  expanded,
  onToggle,
  expandedToolCallIds,
  onToggleToolCall,
  onViewFileInDiff,
}: {
  readonly item: TimelineToolBurst;
  readonly expanded: boolean;
  readonly onToggle?: (burstId: string) => void;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  const summary = summariseToolBurst(item);
  const hasError = item.tools.some((tool) => tool.status === "error");
  const hasOnlyErrors = item.tools.every((tool) => tool.status === "error");
  return (
    <article className={`timeline-tool-burst${hasError ? " timeline-tool-burst--has-error" : ""}${hasOnlyErrors ? " timeline-tool-burst--error" : ""}`}>
      <button
        className="timeline-tool-burst__header"
        type="button"
        aria-expanded={expanded}
        data-testid="timeline-tool-burst"
        onClick={() => onToggle?.(item.id)}
      >
        <span className="timeline-tool-burst__icon" aria-hidden="true">
          <FolderIcon />
        </span>
        <span className="timeline-tool-burst__label">{summary}</span>
        <span className={`timeline-tool-burst__chevron ${expanded ? "timeline-tool-burst__chevron--expanded" : ""}`}>
          <ChevronRightIcon />
        </span>
      </button>
      {expanded ? (
        <div className="timeline-tool-burst__body">
          {item.tools.map((tool) => (
            <TimelineToolCallItem
              key={tool.id}
              item={tool}
              expanded={expandedToolCallIds?.has(tool.callId) ?? false}
              onToggle={onToggleToolCall}
              onViewFileInDiff={onViewFileInDiff}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{item.label}</span>
        {item.metadata ? <span className="timeline-summary__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{item.label}</span>
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}
