import type { ComponentType } from "react";
import { useState } from "react";
import type { TimelineToolCall } from "./timeline-types";
import {
  CompassIcon,
  EyeIcon,
  FileIcon,
  ShieldCheckIcon,
  SparkIcon,
  WrenchIcon,
} from "./icons";
import { useSubagentLive } from "./subagent-live";
import { useOpenSubagentSession } from "./subagent-session-panel";
import { WorkingSpinner } from "./working-label";

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
  readonly sessionFile?: string;
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
    sessionFile: details?.sessionFile,
  };
}

function buildRows(item: TimelineToolCall): SubagentRow[] {
  const input = (item.input ?? {}) as SubagentInput;
  const details = getResultDetails(item.output);

  // Batch launch: children carry their own details, paired by index with input.
  if (details?.children?.length) {
    const childInputs = Array.isArray(input.children) ? input.children : [];
    return details.children.map((child, index) => rowFromDetails(child, childInputs[index]));
  }
  if (Array.isArray(input.children) && input.children.length) {
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

// Per-agent-type visual identity. The `kind` keys a CSS theme (colour ramp)
// applied via `data-agent-kind`; the icon and label give each card a
// glanceable identity when several agents run at once.
interface AgentKind {
  readonly kind: string;
  readonly label: string;
  readonly Icon: ComponentType;
}

const AGENT_KINDS: Record<string, AgentKind> = {
  scout: { kind: "scout", label: "Scout", Icon: CompassIcon },
  verifier: { kind: "verifier", label: "Verifier", Icon: ShieldCheckIcon },
  implementer: { kind: "implementer", label: "Implementer", Icon: WrenchIcon },
};

function agentKind(agent: string | undefined): AgentKind {
  const key = agent?.trim().toLowerCase();
  if (key && AGENT_KINDS[key]) {
    return AGENT_KINDS[key];
  }
  const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : "Agent";
  return { kind: "default", label, Icon: SparkIcon };
}

function SubagentRowView({ row, verb }: { readonly row: SubagentRow; readonly verb: string }) {
  const [showInstructions, setShowInstructions] = useState(false);
  // While the launch is still running, this row becomes the live agent view:
  // surface the spinner, current activity and live stats from the widget feed.
  const live = useSubagentLive(row.name);
  const openSession = useOpenSubagentSession();
  const isLive = (row.status === "running" || row.status === "started") && live !== undefined;
  const elapsed = formatElapsed(row.elapsed);

  const { kind, label, Icon } = agentKind(row.agent);
  // Second line = what the agent is doing now, not its name. Prefer the live
  // activity, then the launch summary (when done), then the task brief.
  const objective = (isLive ? live?.activity : undefined) ?? row.summary ?? row.task ?? row.title;
  const canViewSession = Boolean(row.sessionFile && openSession);

  return (
    <article className="subagent-card" data-agent-kind={kind} data-testid="subagent-card">
      <div className="subagent-card__top">
        <span className="subagent-card__badge" aria-hidden="true">
          <Icon />
        </span>
        <div className="subagent-card__head">
          <div className="subagent-card__title-line">
            <span className="subagent-card__verb">{verb}</span>{" "}
            <span className="subagent-card__type">{label}</span>
            <span className="subagent-card__dot" aria-hidden="true">
              •
            </span>
            <span className="subagent-card__name">{row.name}</span>
          </div>
          {objective ? <p className="subagent-card__objective">{objective}</p> : null}
        </div>
        <div className="subagent-card__meta">
          {isLive ? <WorkingSpinner className="subagent-card__spinner" /> : null}
          <span className={`subagent-card__status subagent-card__status--${row.status}`}>
            {STATUS_LABEL[row.status]}
          </span>
          {elapsed ? <span className="subagent-card__elapsed">{elapsed}</span> : null}
        </div>
      </div>
      {isLive && (live?.stats?.length ?? 0) > 0 ? (
        <div className="subagent-card__live">
          {(live?.stats ?? []).map((stat, index) => (
            <span className="subagent-card__stat" key={index}>
              {stat}
            </span>
          ))}
        </div>
      ) : null}
      {showInstructions && row.task ? (
        <div className="subagent-card__instructions">
          <div className="subagent-card__section-label">Instructions</div>
          <pre className="subagent-card__pre">{row.task}</pre>
        </div>
      ) : null}
      <div className="subagent-card__actions">
        {row.task ? (
          <button
            className="subagent-card__action"
            type="button"
            aria-expanded={showInstructions}
            onClick={() => setShowInstructions((value) => !value)}
          >
            <span className="subagent-card__action-icon" aria-hidden="true">
              <FileIcon />
            </span>
            View instructions
          </button>
        ) : (
          <span />
        )}
        {canViewSession ? (
          <button
            className="subagent-card__icon-action"
            type="button"
            onClick={() => openSession!(row.sessionFile!, row.name)}
            title="Open this subagent's session in a read-only side panel"
            aria-label="View session"
          >
            <EyeIcon />
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function SubagentToolCard({ item }: { readonly item: TimelineToolCall }) {
  const rows = buildRows(item);
  const verb = item.toolName === "subagent_resume" ? "Resume" : "Spawn";

  return (
    <div className="subagent-card-group">
      {rows.map((row, index) => (
        <SubagentRowView key={`${row.name}-${index}`} row={row} verb={verb} />
      ))}
    </div>
  );
}
