/**
 * Chassis Reminder extension — companion pi extension for #49.
 *
 * On `before_agent_start`, reads the chassis state file, looks up the active
 * sticky action for the session's project folder, and if it is a reminder
 * effect, injects the reminder text as a persistent message for the LLM.
 *
 * Self-contained: re-implements the minimal parse needed so the extension has
 * zero imports from the desktop app (pi loads it via jiti in its own runtime).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Minimal chassis-state parse (mirrors src/chassis.ts logic)
// ---------------------------------------------------------------------------

interface ReminderEffect {
  readonly type: "reminder";
  readonly text: string;
}

interface ChassisAction {
  readonly id: string;
  readonly trigger: string;
  readonly effect: { readonly type: string; readonly text?: string; readonly template?: string };
}

interface FolderState {
  readonly actions: ChassisAction[];
  readonly activeStickyId: string | null;
}

function parseFolder(raw: unknown): FolderState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const actions: ChassisAction[] = [];
  if (Array.isArray(v.actions)) {
    for (const entry of v.actions) {
      if (typeof entry !== "object" || entry === null) continue;
      const a = entry as Record<string, unknown>;
      if (typeof a.id !== "string" || !a.id) continue;
      if (typeof a.trigger !== "string") continue;
      const eff = a.effect;
      if (typeof eff !== "object" || eff === null) continue;
      const e = eff as Record<string, unknown>;
      if (typeof e.type !== "string") continue;
      actions.push({
        id: a.id,
        trigger: a.trigger,
        effect: { type: e.type, text: e.text as string | undefined, template: e.template as string | undefined },
      });
    }
  }
  const rawActive = typeof v.activeStickyId === "string" ? v.activeStickyId : null;
  const activeStickyId = actions.some((a) => a.id === rawActive) ? rawActive : null;
  return { actions, activeStickyId };
}

/**
 * Given raw JSON text of a chassis/state.json file and a folder path, return
 * the active reminder text for that folder — or `undefined` if none.
 */
export function resolveActiveReminder(raw: string, folderPath: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const p = parsed as Record<string, unknown>;
  if (p.version !== 2 || typeof p.folders !== "object" || p.folders === null) return undefined;
  const folders = p.folders as Record<string, unknown>;
  const folder = parseFolder(folders[folderPath]);
  if (!folder || !folder.activeStickyId) return undefined;
  const action = folder.actions.find((a) => a.id === folder.activeStickyId);
  if (!action || action.effect.type !== "reminder") return undefined;
  const text = action.effect.text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export default function chassisReminderExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (_event, ctx) => {
    const cwd = ctx.cwd;
    if (!cwd) return undefined;

    const statePath = join(getAgentDir(), "chassis", "state.json");
    let raw: string;
    try {
      raw = await readFile(statePath, "utf8");
    } catch {
      // No chassis state file — nothing to inject.
      return undefined;
    }

    const reminderText = resolveActiveReminder(raw, cwd);
    if (!reminderText) return undefined;

    return {
      message: {
        customType: "chassis-reminder",
        content: reminderText,
        display: false,
      },
    };
  });
}
