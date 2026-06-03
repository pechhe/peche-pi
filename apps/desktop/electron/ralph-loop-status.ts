import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RalphLoopStatus } from "../src/desktop-state";

/**
 * Parse the minimal subset of `.ralph/loop.md` frontmatter the desktop needs to
 * present a loop thread as a locked, controllable surface. The file is written
 * by the pi-ralph-loop extension; its frontmatter is simple `key: value` YAML
 * with quoted strings, bare numbers/booleans, and `null`.
 *
 * Returns null when there is no loop file (the common case) so callers treat the
 * thread as an ordinary session.
 */
export function readRalphLoopStatus(
  workspacePath: string,
  selectedSessionId: string,
): RalphLoopStatus | null {
  let content: string;
  try {
    content = readFileSync(join(workspacePath, ".ralph", "loop.md"), "utf-8");
  } catch {
    return null;
  }

  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter?.[1]) {
    return null;
  }

  const fields = new Map<string, string>();
  for (const line of frontmatter[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const sessionId = parseString(fields.get("session_id"));
  return {
    running: fields.get("running") === "true",
    iteration: parseNumber(fields.get("iteration")) ?? 0,
    maxIterations: parseNumber(fields.get("max_iterations")) ?? 0,
    ...(parseString(fields.get("stop_reason")) ? { stopReason: parseString(fields.get("stop_reason")) } : {}),
    ...(sessionId ? { sessionId } : {}),
    isSelectedSessionActive: Boolean(sessionId) && sessionId === selectedSessionId,
  };
}

function parseString(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "null") {
    return undefined;
  }
  const unquoted = raw.replace(/^["']|["']$/g, "");
  return unquoted.length > 0 ? unquoted : undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}
