import { useState } from "react";
import type { TimelineToolCall } from "./timeline-types";
import { ChevronRightIcon } from "./icons";

// Inline rendering for the pi-subagents `subagent` / `subagent_resume` tool
// calls. Reads the launch params from `input` and the launch/completion result
// from `output.details` (the AgentToolResult.details emitted by the extension).
//
// Async launches return `status: "started"` and never update this row (their
// final result arrives as a separate custom message, not surfaced inline yet).
// Blocking launches return a completion status with a summary.

type SubagentStatus = "started" | "running" | "completed" | "failed" | "cancelled" | "batch";

interface SubagentChildInput {
  readonly name?: string;
  readonly agent?: string;
  readonly title?: string;
  readonly task?: string;
}

interface SubagentInput extends SubagentChildInput {
  readonly children?: readonly SubagentChildInput[];
}

interface SubagentDetails {
  readonly status?: string;
  readonly name?: string;
  readonly agent?: string;
  readonly title?: string;
  readonly task?: string;
  readonly summary?: string;
  readonly elapsed?: number;
  readonly exitCode?: number;
  readonly errorMessage?: string;
  readonly sessionFile?: string;
  readonly children?: readonly SubagentDetails[];
}

interface SubagentRow {
  readonly name: string;
  readonly agent?: string;
  readonly title?: string;
  readonly task?: string;
  readonly summary?: string;
  readonly status: SubagentStatus;
  readonly elapsed?: number;
}

export function isSubagentTool(toolName: string): boolean {
  return toolName === "subagent" || toolName === "subagent_resume";
}

function getResultDetails(output: unknown): SubagentDetails | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const details = (output as { details?: unknown }).details;
  return typeof details === "object" && details !== null ? (details as SubagentDetails) : undefined;
}

function normaliseStatus(raw: string | undefined, exitCode: number | undefined, errorMessage: string | undefined): SubagentStatus {
  if (raw === "started" || raw === "batch") {
    return raw;
  }
  if (raw === "completed" || raw === "failed" || raw === "cancelled" || raw === "running") {
    return raw;
  }
  if (errorMessage) {
    return "failed";
  }
  if (typeof exitCode === "number") {
    return exitCode === 0 ? "completed" : "failed";
  }
  return "running";
}

function rowFromDetails(
  details: SubagentDetails | undefined,
  fallback: SubagentChildInput | undefined,
): SubagentRow {
  const name = details?.name ?? fallback?.name ?? "subagent";
  return {
    name,
    agent: details?.agent ?? fallback?.agent,
    title: details?.title ?? fallback?.title,
    task: details?.task ?? fallback?.task,
    summary: details?.summary ?? details?.errorMessage,
    status: normaliseStatus(details?.status, details?.exitCode, details?.errorMessage),
    elapsed: details?.elapsed,
  };
}

function buildRows(item: TimelineToolCall): SubagentRow[] {
  const input = (item.input ?? {}) as SubagentInput;
  const details = getResultDetails(item.output);

  // Batch launch: children carry their own details, paired by index with input.
  if (details?.children?.length) {
    return details.children.map((child, index) => rowFromDetails(child, input.children?.[index]));
  }
  if (input.children?.length) {
    return input.children.map((child) => rowFromDetails(undefined, child));
  }

  // Single launch.
  const row = rowFromDetails(details, input);
  // When the tool call is still running (no result yet), reflect that.
  if (!details && item.status === "running") {
    return [{ ...row, status: "running" }];
  }
  return [row];
}

function formatElapsed(seconds: number | undefined): string | undefined {
  if (seconds == null) {
    return undefined;
  }
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const STATUS_LABEL: Record<SubagentStatus, string> = {
  started: "started",
  running: "running",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
  batch: "batch",
};

function SubagentRowView({ row }: { readonly row: SubagentRow }) {
  const [expanded, setExpanded] = useState(false);
  const elapsed = formatElapsed(row.elapsed);
  const hasBody = Boolean(row.task || row.summary);

  return (
    <div className="subagent-card__row">
      <button
        className="subagent-card__row-head"
        type="button"
        aria-expanded={expanded}
        disabled={!hasBody}
        onClick={() => setExpanded((value) => !value)}
      >
        {hasBody ? (
          <span className={`subagent-card__chevron ${expanded ? "subagent-card__chevron--expanded" : ""}`}>
            <ChevronRightIcon />
          </span>
        ) : (
          <span className="subagent-card__chevron-spacer" />
        )}
        <span className="subagent-card__name">{row.name}</span>
        {row.agent ? <span className="subagent-card__agent">{row.agent}</span> : null}
        {row.title ? <span className="subagent-card__title">{row.title}</span> : null}
        <span className={`subagent-card__status subagent-card__status--${row.status}`}>
          {STATUS_LABEL[row.status]}
        </span>
        {elapsed ? <span className="subagent-card__elapsed">{elapsed}</span> : null}
      </button>
      {expanded && hasBody ? (
        <div className="subagent-card__body">
          {row.task ? (
            <div className="subagent-card__section">
              <div className="subagent-card__section-label">Task</div>
              <pre className="subagent-card__pre">{row.task}</pre>
            </div>
          ) : null}
          {row.summary ? (
            <div className="subagent-card__section">
              <div className="subagent-card__section-label">Result</div>
              <pre className="subagent-card__pre">{row.summary}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SubagentToolCard({ item }: { readonly item: TimelineToolCall }) {
  const rows = buildRows(item);
  const isBatch = rows.length > 1;
  const verb = item.toolName === "subagent_resume" ? "Resume" : "Spawn";
  const heading = isBatch ? `${verb} ${rows.length} agents` : verb;

  return (
    <article className="subagent-card" data-testid="subagent-card">
      <div className="subagent-card__heading">
        <span className="subagent-card__heading-icon" aria-hidden="true">
          ▸
        </span>
        <span className="subagent-card__heading-text">{heading}</span>
      </div>
      <div className="subagent-card__rows">
        {rows.map((row, index) => (
          <SubagentRowView key={`${row.name}-${index}`} row={row} />
        ))}
      </div>
    </article>
  );
}
