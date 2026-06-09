import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranscriptMessage } from "./timeline-types";
import type { FleetAgent } from "./subagent-fleet";
import { formatRelativeTime } from "./string-utils";

// ── Data model ──────────────────────────────────────────────────────────────
//
// An "agent entity" is the single persistent thing the user cares about. It is
// reconstructed by grouping every `subagent` / `subagent_resume` tool call in
// the transcript by agent *name*. The first launch for a name owns the entity;
// later launches (resume, or a fresh re-spawn after the agent got stuck) fold
// in as additional events on the same entity instead of spawning new cards.

export type SubagentStatus = "started" | "running" | "completed" | "failed" | "cancelled" | "batch";

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

export interface SubagentRow {
  readonly name: string;
  readonly agent?: string;
  readonly title?: string;
  readonly task?: string;
  readonly summary?: string;
  readonly status: SubagentStatus;
  readonly elapsed?: number;
  readonly sessionFile?: string;
}

/** A single launch event (spawn or resume) on an agent entity. */
export interface AgentEvent extends SubagentRow {
  readonly callId: string;
  readonly createdAt: string;
  readonly verb: "Spawn" | "Resume";
}

export interface AgentEntity {
  readonly name: string;
  readonly agent?: string;
  /** callId of the launch that first introduced this name (owns the card). */
  readonly primaryCallId: string;
  readonly events: AgentEvent[];
}

export type ToolLike = Extract<TranscriptMessage, { kind: "tool" }>;

export function isSubagentTool(toolName: string): boolean {
  return toolName === "subagent" || toolName === "subagent_resume";
}

function getResultDetails(output: unknown): SubagentDetails | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const details = (output as { details?: unknown }).details;
  return typeof details === "object" && details !== null ? (details as SubagentDetails) : undefined;
}

function normaliseStatus(
  raw: string | undefined,
  exitCode: number | undefined,
  errorMessage: string | undefined,
): SubagentStatus {
  if (raw === "started" || raw === "batch") return raw;
  if (raw === "completed" || raw === "failed" || raw === "cancelled" || raw === "running") return raw;
  if (errorMessage) return "failed";
  if (typeof exitCode === "number") return exitCode === 0 ? "completed" : "failed";
  return "running";
}

function rowFromDetails(details: SubagentDetails | undefined, fallback: SubagentChildInput | undefined): SubagentRow {
  return {
    name: details?.name ?? fallback?.name ?? "subagent",
    agent: details?.agent ?? fallback?.agent,
    title: details?.title ?? fallback?.title,
    task: details?.task ?? fallback?.task,
    summary: details?.summary ?? details?.errorMessage,
    status: normaliseStatus(details?.status, details?.exitCode, details?.errorMessage),
    elapsed: details?.elapsed,
    sessionFile: details?.sessionFile,
  };
}

/** Extract one row per agent launched by a single tool call (batch-aware). */
export function buildRows(item: ToolLike): SubagentRow[] {
  const input = (item.input ?? {}) as SubagentInput;
  const details = getResultDetails(item.output);

  if (details?.children?.length) {
    const childInputs = Array.isArray(input.children) ? input.children : [];
    return details.children.map((child, index) => rowFromDetails(child, childInputs[index]));
  }
  if (Array.isArray(input.children) && input.children.length) {
    return input.children.map((child) => rowFromDetails(undefined, child));
  }
  const row = rowFromDetails(details, input);
  if (!details && item.status === "running") return [{ ...row, status: "running" }];
  return [row];
}

/** Group every subagent launch in the transcript into one entity per name. */
export function collectAgents(transcript: readonly TranscriptMessage[]): {
  entities: Map<string, AgentEntity>;
  primaryNamesByCall: Map<string, string[]>;
} {
  const entities = new Map<string, AgentEntity>();
  const primaryNamesByCall = new Map<string, string[]>();

  for (const item of transcript) {
    if (item.kind !== "tool" || !isSubagentTool(item.toolName)) continue;
    const tool = item as ToolLike;
    const verb: AgentEvent["verb"] = tool.toolName === "subagent_resume" ? "Resume" : "Spawn";
    for (const row of buildRows(tool)) {
      const event: AgentEvent = { ...row, callId: tool.callId, createdAt: tool.createdAt, verb };
      let entity = entities.get(row.name);
      if (!entity) {
        entity = { name: row.name, agent: row.agent, primaryCallId: tool.callId, events: [] };
        entities.set(row.name, entity);
        const names = primaryNamesByCall.get(tool.callId) ?? [];
        names.push(row.name);
        primaryNamesByCall.set(tool.callId, names);
      }
      if (!entity.agent && row.agent) (entity as { agent?: string }).agent = row.agent;
      entity.events.push(event);
    }
  }
  return { entities, primaryNamesByCall };
}

// ── Context ──────────────────────────────────────────────────────────────────

interface AgentTimelineValue {
  readonly entities: Map<string, AgentEntity>;
  readonly primaryNamesByCall: Map<string, string[]>;
}

const AgentTimelineContext = createContext<AgentTimelineValue | null>(null);

export function SubagentTimelineProvider({
  transcript,
  children,
}: {
  readonly transcript: readonly TranscriptMessage[];
  readonly children: ReactNode;
}) {
  const value = useMemo(() => collectAgents(transcript), [transcript]);
  return <AgentTimelineContext.Provider value={value}>{children}</AgentTimelineContext.Provider>;
}

/**
 * Resolve what a given tool call should render:
 * - the entities it *introduces* (render the merged card for each), or
 * - `null` when the provider is absent (fall back to a standalone card), or
 * - an empty list when this call is a folded resume/re-spawn (render nothing).
 */
export function useCallEntities(callId: string): AgentEntity[] | null {
  const ctx = useContext(AgentTimelineContext);
  if (!ctx) return null;
  const names = ctx.primaryNamesByCall.get(callId) ?? [];
  return names.map((name) => ctx.entities.get(name)!).filter(Boolean);
}

// ── Live activity log (client-side, ephemeral) ────────────────────────────────
//
// The fleet widget only reports the *current* activity. To draw the journey we
// record each distinct activity string with the time we first saw it, keyed by
// agent name, in a module map that survives card remounts within a session.

interface ActivityEntry {
  readonly activity: string;
  readonly at: number;
}

const activityStore = new Map<string, ActivityEntry[]>();

function useAgentActivityLog(name: string, activity: string | undefined): ActivityEntry[] {
  const [, force] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const log = activityStore.get(name) ?? [];
    if (log[log.length - 1]?.activity === activity) return;
    activityStore.set(name, [...log, { activity, at: Date.now() }]);
    force((n) => n + 1);
  }, [name, activity]);
  return activityStore.get(name) ?? [];
}

// ── Node model ────────────────────────────────────────────────────────────────

export type NodeTone = "done" | "active" | "blocked" | "failed" | "cancelled";

export interface TimelineNode {
  readonly id: string;
  readonly tone: NodeTone;
  readonly title: string;
  readonly subtitle?: string;
  readonly at: string;
}

function eventTime(ev: AgentEvent, seq: number): number {
  const t = Date.parse(ev.createdAt);
  return Number.isNaN(t) ? seq : t;
}

function relAt(t: number): string {
  const rel = formatRelativeTime(new Date(t).toISOString());
  return rel === "now" ? "Now" : `${rel} ago`;
}

/**
 * Build the ordered execution journey for an entity by merging launch events
 * with the recorded activity log, then classifying the tail by live state.
 */
function buildNodes(entity: AgentEntity, log: ActivityEntry[], isLive: boolean, liveActivity?: string): TimelineNode[] {
  type U =
    | { t: number; kind: "event"; ev: AgentEvent }
    | { t: number; kind: "activity"; a: ActivityEntry };
  const merged: U[] = [];
  entity.events.forEach((ev, i) => merged.push({ t: eventTime(ev, i), kind: "event", ev }));
  log.forEach((a) => merged.push({ t: a.at, kind: "activity", a }));
  merged.sort((x, y) => x.t - y.t);

  const nodes: TimelineNode[] = [];
  let eventSeen = 0;
  let prevCompleted = false;
  let lastActivityIdx = -1;

  for (const u of merged) {
    if (u.kind === "event") {
      eventSeen += 1;
      const ev = u.ev;
      // A resume / re-spawn implies the prior thread paused. If it had not
      // cleanly completed, surface the pause as an explicit blocker node that
      // the intervention then reconnects.
      if (eventSeen > 1 && !prevCompleted) {
        nodes.push({
          id: `${ev.callId}-block`,
          tone: "blocked",
          title: "Paused — awaiting input",
          at: relAt(u.t),
        });
      }
      const first = eventSeen === 1;
      const title = ev.verb === "Resume" ? "Resumed by user" : first ? "Spawned" : "Relaunched";
      const subtitle =
        ev.verb === "Resume"
          ? ev.task
            ? `“${ev.task}”`
            : undefined
          : first
            ? ev.task
            : ev.summary ?? ev.task;
      nodes.push({ id: `${ev.callId}-${eventSeen}`, tone: "done", title, subtitle, at: relAt(u.t) });
      prevCompleted = ev.status === "completed";
    } else {
      lastActivityIdx = nodes.length;
      nodes.push({ id: `act-${u.t}`, tone: "done", title: u.a.activity, at: relAt(u.t) });
    }
  }

  // Tail: reflect the live / terminal state.
  if (isLive) {
    const current = liveActivity ?? "Working…";
    if (lastActivityIdx >= 0 && nodes[lastActivityIdx]!.title === current) {
      nodes[lastActivityIdx] = { ...nodes[lastActivityIdx]!, tone: "active", at: "Now" };
    } else {
      nodes.push({ id: `act-now`, tone: "active", title: current, at: "Now" });
    }
  } else {
    const last = entity.events[entity.events.length - 1];
    if (last && (last.status === "failed" || last.status === "cancelled")) {
      nodes.push({
        id: `${last.callId}-term`,
        tone: last.status,
        title: last.status === "failed" ? "Failed" : "Cancelled",
        subtitle: last.summary,
        at: relAt(eventTime(last, entity.events.length)),
      });
    } else if (last?.status === "completed") {
      nodes.push({
        id: `${last.callId}-done`,
        tone: "done",
        title: "Completed",
        subtitle: last.summary,
        at: relAt(eventTime(last, entity.events.length)),
      });
    }
  }
  return nodes;
}

export interface AgentJourney {
  readonly nodes: TimelineNode[];
  readonly isLive: boolean;
  readonly latest: AgentEvent;
}

/** Compose the full journey for an entity, wiring in the live fleet feed. */
export function useAgentJourney(entity: AgentEntity, live: FleetAgent | undefined): AgentJourney {
  const latest = entity.events[entity.events.length - 1]!;
  const isLive = (latest.status === "running" || latest.status === "started") && live !== undefined;
  const log = useAgentActivityLog(entity.name, isLive ? live?.activity : undefined);
  const nodes = useMemo(
    () => buildNodes(entity, log, isLive, live?.activity),
    [entity, log, isLive, live?.activity],
  );
  return { nodes, isLive, latest };
}
