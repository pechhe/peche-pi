import type { ComponentType } from "react";
import { useState } from "react";
import type { TimelineToolCall } from "./timeline-types";
import {
  CheckIcon,
  CloseIcon,
  CompassIcon,
  EyeIcon,
  FileIcon,
  ShieldCheckIcon,
  SparkIcon,
  TelescopeIcon,
  WrenchIcon,
} from "./icons";
import { useSubagentLive } from "./subagent-live";
import { useOpenSubagentSession } from "./subagent-session-panel";
import { WorkingSpinner } from "./working-label";
import { formatRelativeTime } from "./string-utils";
import {
  buildRows,
  isSubagentTool,
  useAgentJourney,
  useCallEntities,
  type AgentEntity,
  type NodeTone,
} from "./subagent-timeline";

export { isSubagentTool };

// Per-agent-type visual identity. The `kind` keys a CSS theme (colour ramp)
// applied via `data-agent-kind`; the icon and label give each entity a
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
  researcher: { kind: "researcher", label: "Researcher", Icon: TelescopeIcon },
};

function agentKind(agent: string | undefined): AgentKind {
  const key = agent?.trim().toLowerCase();
  if (key && AGENT_KINDS[key]) return AGENT_KINDS[key];
  const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : "Agent";
  return { kind: "default", label, Icon: SparkIcon };
}

function NodeMarker({ tone }: { readonly tone: NodeTone }) {
  return (
    <span className={`agent-entity__marker agent-entity__marker--${tone}`} aria-hidden="true">
      {tone === "done" ? <CheckIcon /> : tone === "failed" || tone === "cancelled" ? <CloseIcon /> : null}
    </span>
  );
}

/**
 * The single persistent agent entity. Renders one header plus a vertical
 * execution journey built from every spawn / resume on this agent name. New
 * nodes animate in as the journey advances.
 */
function AgentEntityCard({ entity }: { readonly entity: AgentEntity }) {
  const [showInstructions, setShowInstructions] = useState(false);
  const live = useSubagentLive(entity.name);
  const openSession = useOpenSubagentSession();
  const { nodes, isLive, latest } = useAgentJourney(entity, live);

  const { kind, label, Icon } = agentKind(entity.agent);
  const startedRel = formatRelativeTime(entity.events[0]!.createdAt);
  const stats = isLive ? live?.stats ?? [] : [];
  const task = latest.task ?? entity.events[0]!.task;
  const canViewSession = Boolean(latest.sessionFile && openSession);

  const headState = isLive
    ? "Active"
    : latest.status === "failed"
      ? "Failed"
      : latest.status === "cancelled"
        ? "Cancelled"
        : latest.status === "completed"
          ? "Completed"
          : "Idle";

  return (
    <article className="agent-entity" data-agent-kind={kind} data-testid="subagent-card">
      <header className="agent-entity__header">
        <span className="agent-entity__badge" aria-hidden="true">
          <Icon />
        </span>
        <div className="agent-entity__id">
          <div className="agent-entity__title-line">
            <span className="agent-entity__type">{label}</span>
            <span className="agent-entity__name">{entity.name}</span>
          </div>
          <div className="agent-entity__sub">
            <span className={`agent-entity__state agent-entity__state--${headState.toLowerCase()}`}>
              {isLive ? <WorkingSpinner className="agent-entity__spinner" title="Working" /> : null}
              {headState}
            </span>
            {stats.length > 0 ? <span className="agent-entity__stats">{stats.join(" · ")}</span> : null}
            {startedRel ? <span className="agent-entity__started">started {startedRel} ago</span> : null}
          </div>
        </div>
        {canViewSession ? (
          <button
            className="agent-entity__eye"
            type="button"
            onClick={() => openSession!(latest.sessionFile!, entity.name)}
            title="Open this subagent's session in a read-only side panel"
            aria-label="View session"
          >
            <EyeIcon />
          </button>
        ) : null}
      </header>

      <ol className="agent-entity__journey">
        {nodes.map((node) => (
          <li className={`agent-entity__node agent-entity__node--${node.tone}`} key={node.id}>
            <span className="agent-entity__time">{node.at}</span>
            <NodeMarker tone={node.tone} />
            <div className="agent-entity__body">
              <span className="agent-entity__node-title">{node.title}</span>
              {node.subtitle ? <p className="agent-entity__node-sub">{node.subtitle}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      {(task || canViewSession) && (
        <footer className="agent-entity__footer">
          {task ? (
            <button
              className="agent-entity__action"
              type="button"
              aria-expanded={showInstructions}
              onClick={() => setShowInstructions((v) => !v)}
            >
              <span className="agent-entity__action-icon" aria-hidden="true">
                <FileIcon />
              </span>
              View instructions
            </button>
          ) : (
            <span />
          )}
        </footer>
      )}
      {showInstructions && task ? (
        <div className="agent-entity__instructions">
          <div className="agent-entity__section-label">Instructions</div>
          <pre className="agent-entity__pre">{task}</pre>
        </div>
      ) : null}
    </article>
  );
}

export function SubagentToolCard({ item }: { readonly item: TimelineToolCall }) {
  // When the provider is mounted (main thread), one entity is reconstructed
  // across the whole transcript: this call renders the entities it introduces,
  // and renders nothing for a folded resume / re-spawn of an existing name.
  const fromContext = useCallEntities(item.callId);
  // Fallback (e.g. the read-only subagent session panel): no provider, so build
  // a transient single-call entity from this row alone.
  const entities: AgentEntity[] =
    fromContext ??
    buildRows(item).map((row) => ({
      name: row.name,
      agent: row.agent,
      primaryCallId: item.callId,
      events: [{ ...row, callId: item.callId, createdAt: item.createdAt, verb: item.toolName === "subagent_resume" ? "Resume" : "Spawn" }],
    }));

  if (entities.length === 0) return null;

  return (
    <div className="agent-entity-group">
      {entities.map((entity) => (
        <AgentEntityCard key={entity.name} entity={entity} />
      ))}
    </div>
  );
}
