// Pure parsing for the pi-subagents live "fleet" widget. The extension
// publishes a TUI widget via ctx.ui.setWidget("subagent-status", lines, ...).
// The pi-sdk-driver host theme returns text unchanged, so captured lines are
// plain text (no ANSI). We parse the known layout into structured rows.
//
// Widget layout (plain text, tree-drawn):
//   ● Agents · 2 running · 12.3s
//   ├─ ◜ auth-scout [scout] · 3 tool uses · 12.5%/200k ctx
//   │    Auth implementation map
//   │    reading…
//   └─ ◜ diff-reviewer [reviewer] · 1 tool use · ...
//        ...title...
//        ...activity...

export const FLEET_WIDGET_KEY = "subagent-status";

export interface FleetAgent {
  readonly name: string;
  readonly agent?: string;
  readonly stats: readonly string[];
  readonly title?: string;
  readonly activity?: string;
}

export interface Fleet {
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
      const stats = badge[3];
      current = {
        name: (badge[1] ?? "").trim(),
        agent: badge[2],
        stats: stats ? stats.split(/\s*·\s*/).filter(Boolean) : [],
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
