import { memo } from "react";
import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";

// Tracks user-message ids whose entrance animation has already played. We use a
// module-level Set so virtualised remounts (scroll-back) don't replay the
// animation, while genuinely new submissions still animate. The createdAt gate
// suppresses animation when an existing transcript is loaded for the first
// time.
const animatedUserMessageIds = new Set<string>();

function shouldAnimateUserBubble(item: SessionTranscriptMessage): boolean {
  if (animatedUserMessageIds.has(item.id)) {
    return false;
  }
  animatedUserMessageIds.add(item.id);
  const createdAt = Date.parse(item.createdAt);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  return Date.now() - createdAt < 1500;
}
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "./timeline-types";
import type { TimelineRow, TimelineToolBurst } from "./timeline-grouping";
import { summariseToolBurst } from "./timeline-grouping";
import { MessageMarkdown } from "./message-markdown";
import { InlineDiff, extractDiffFromOutput } from "./diff-inline";
import { ChevronRightIcon, CopyIcon, DiffIcon, FileIcon } from "./icons";
import { openImageLightbox } from "./image-lightbox";
import { extensionToLanguage } from "./syntax-highlight";

export const TimelineItem = memo(function TimelineItem({
  item,
  expandedToolCallIds,
  expandedBurstIds,
  onToggleToolCall,
  onToggleBurst,
  onViewFileInDiff,
}: {
  readonly item: TimelineRow;
  readonly expandedToolCallIds?: ReadonlySet<string>;
  readonly expandedBurstIds?: ReadonlySet<string>;
  readonly onToggleToolCall?: (callId: string) => void;
  readonly onToggleBurst?: (burstId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
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
  if (prev.onViewFileInDiff !== next.onViewFileInDiff) return false;
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
  return true;
}

function TimelineMessage({ item }: { readonly item: SessionTranscriptMessage }) {
  if (item.role === "user") {
    const justSent = shouldAnimateUserBubble(item);
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
          <MessageMarkdown text={item.text} />
        </div>
      </article>
    );
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

  return (
    <article className="timeline-item timeline-item--assistant">
      <MessageMarkdown text={item.text} />
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
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) : undefined;
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

function buildCompactLabel(item: TimelineToolCall, diffStats: { added: number; removed: number } | undefined): string {
  if (isWriteTool(item.toolName)) {
    const filename = extractFilename(item.input);
    if (filename) {
      return `Edited ${shortenPath(filename)}`;
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
  return (
    <article className={`timeline-tool-burst${hasError ? " timeline-tool-burst--error" : ""}`}>
      <button
        className="timeline-tool-burst__header"
        type="button"
        aria-expanded={expanded}
        data-testid="timeline-tool-burst"
        onClick={() => onToggle?.(item.id)}
      >
        <span className={`timeline-tool-burst__chevron ${expanded ? "timeline-tool-burst__chevron--expanded" : ""}`}>
          <ChevronRightIcon />
        </span>
        <span className="timeline-tool-burst__label">{summary}</span>
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
