import { useMemo } from "react";
import type { SessionExtensionWidgetRecord } from "./desktop-state";

// Live "fleet" panel for pi-subagents. The extension publishes a TUI widget via
// ctx.ui.setWidget("subagent-status", lines, ...). The pi-sdk-driver host theme
// returns text unchanged, so the captured lines are plain text (no ANSI). We
// parse the known widget layout into structured rows. Read-only: no kill/resume
// controls in this pass.
//
// Widget layout (plain text, tree-drawn):
//   ● Agents · 2 running · 12.3s
//   ├─ ◜ auth-scout [scout] · 3 tool uses · 12.5%/200k ctx
//   │    Auth implementation map
//   │    reading…
//   └─ ◜ diff-reviewer [reviewer] · 1 tool use · ...
//        ...title...
//        ...activity...

const FLEET_WIDGET_KEY = "subagent-status";

interface FleetAgent {
  readonly name: string;
  readonly agent?: string;
  readonly stats: readonly string[];
  readonly title?: string;
  readonly activity?: string;
}

interface Fleet {
  readonly count: number;
  readonly agents: readonly FleetAgent[];
}

// Strip leading tree connectors, spinner glyphs, bullets and whitespace.
function stripTreePrefix(line: string): string {
  return line.replace(/^[\s│├└─◜◠◝◞◡◟●◍•]+/u, "").trim();
}

const BADGE_PATTERN = /^(.+?)\s+\[([a-z0-9-]+)\](?:\s*·\s*(.*))?$/;

export function parseFleet(lines: readonly string[]): Fleet | null {
  if (lines.length === 0) {
    return null;
  }

  const headerLine = lines.find((line) => /Agents/.test(line) && /running/.test(line));
  const count = Number(headerLine?.match(/(\d+)\s+running/)?.[1] ?? 0);

  const agents: FleetAgent[] = [];
  let current: { name: string; agent?: string; stats: string[]; title?: string; activity?: string } | null = null;

  for (const raw of lines) {
    if (raw === headerLine) {
      continue;
    }
    const line = stripTreePrefix(raw);
    if (!line) {
      continue;
    }
    const badge = line.match(BADGE_PATTERN);
    if (badge) {
      current = {
        name: badge[1].trim(),
        agent: badge[2],
        stats: badge[3] ? badge[3].split(/\s*·\s*/).filter(Boolean) : [],
      };
      agents.push(current);
      continue;
    }
    if (current) {
      if (current.title === undefined) {
        current.title = line;
      } else if (current.activity === undefined) {
        current.activity = line;
      }
    }
  }

  if (agents.length === 0 && count === 0) {
    return null;
  }
  return { count: count || agents.length, agents };
}

export function SubagentFleetPanel({
  widgets,
}: {
  readonly widgets: readonly SessionExtensionWidgetRecord[];
}) {
  const fleet = useMemo(() => {
    const record = widgets.find((widget) => widget.key === FLEET_WIDGET_KEY);
    return record ? parseFleet(record.lines) : null;
  }, [widgets]);

  if (!fleet || fleet.agents.length === 0) {
    return null;
  }

  return (
    <section className="subagent-fleet" data-testid="subagent-fleet">
      <div className="subagent-fleet__header">
        <span className="subagent-fleet__pulse" aria-hidden="true" />
        <span className="subagent-fleet__title">Agents</span>
        <span className="subagent-fleet__count">{fleet.count} running</span>
      </div>
      <ul className="subagent-fleet__list">
        {fleet.agents.map((agent, index) => (
          <li className="subagent-fleet__item" key={`${agent.name}-${index}`}>
            <div className="subagent-fleet__item-head">
              <span className="subagent-fleet__spinner" aria-hidden="true" />
              <span className="subagent-fleet__name">{agent.name}</span>
              {agent.agent ? <span className="subagent-fleet__agent">{agent.agent}</span> : null}
              {agent.stats.map((stat, statIndex) => (
                <span className="subagent-fleet__stat" key={statIndex}>
                  {stat}
                </span>
              ))}
            </div>
            {agent.title ? <div className="subagent-fleet__item-title">{agent.title}</div> : null}
            {agent.activity ? <div className="subagent-fleet__item-activity">{agent.activity}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
