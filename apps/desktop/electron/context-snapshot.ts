import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  ContextSection,
  ContextSnapshot,
} from "../src/desktop-state";

/**
 * Build a ContextSnapshot from first-party runtime data and workspace files.
 *
 * This is a pure data transform — no side-effects, fully testable.
 */
export function buildContextSnapshot(params: {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly sessionId?: string;
  readonly agentsMd?: string;
  readonly claudeMd?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly sessionCommands?: readonly { name: string; source: string }[];
  readonly sessionProvider?: string;
  readonly sessionModelId?: string;
  readonly sessionThinkingLevel?: string;
}): ContextSnapshot {
  const sections: ContextSection[] = [];

  // 1. System prompt
  sections.push({
    kind: "system-prompt",
    label: "System prompt",
    origin: "pi runtime",
    scope: "global",
    enabled: true,
    content: params.runtime
      ? "The pi runtime assembles the system prompt from your workspace context, skills, extensions, and model settings."
      : "No runtime loaded. Start a workspace to see the effective system prompt.",
  });

  // 2. Context files (AGENTS.md, CLAUDE.md)
  if (params.agentsMd) {
    sections.push({
      kind: "context-file",
      label: "AGENTS.md",
      origin: "workspace",
      scope: "project",
      enabled: true,
      path: join(params.workspacePath, "AGENTS.md"),
      content: params.agentsMd,
    });
  }
  if (params.claudeMd) {
    sections.push({
      kind: "context-file",
      label: "CLAUDE.md",
      origin: "workspace",
      scope: "project",
      enabled: true,
      path: join(params.workspacePath, "CLAUDE.md"),
      content: params.claudeMd,
    });
  }

  // 3. Skills
  const skills = params.runtime?.skills ?? [];
  for (const skill of skills) {
    sections.push({
      kind: "skill",
      label: skill.name,
      origin: skill.source,
      scope: skill.source,
      enabled: skill.enabled,
      path: skill.filePath,
      detail: skill.description,
    });
  }

  // 4. Extensions and tools
  const extensions = params.runtime?.extensions ?? [];
  for (const ext of extensions) {
    const toolNames = ext.tools.join(", ");
    sections.push({
      kind: "extension",
      label: ext.displayName,
      origin: ext.sourceInfo.source,
      scope: ext.sourceInfo.scope,
      enabled: ext.enabled,
      path: ext.path,
      detail: toolNames ? `Tools: ${toolNames}` : ext.commands.join(", "),
    });
  }

  // 5. Commands / prompts
  const commands = params.sessionCommands ?? [];
  for (const cmd of commands) {
    sections.push({
      kind: "command",
      label: `/${cmd.name}`,
      origin: cmd.source,
      scope: "session",
      enabled: true,
    });
  }

  // 6. Model / runtime settings
  const settings = params.runtime?.settings;
  if (settings) {
    const parts: string[] = [];
    if (settings.defaultProvider) parts.push(`Provider: ${settings.defaultProvider}`);
    if (settings.defaultModelId) parts.push(`Model: ${settings.defaultModelId}`);
    if (settings.defaultThinkingLevel) parts.push(`Thinking: ${settings.defaultThinkingLevel}`);
    if (settings.enableSkillCommands) parts.push("Skill commands: enabled");
    if (settings.enabledModelPatterns.length > 0) {
      parts.push(`Model patterns: ${settings.enabledModelPatterns.join(", ")}`);
    }
    sections.push({
      kind: "model-settings",
      label: "Runtime settings",
      origin: "settings",
      scope: "project",
      enabled: true,
      content: parts.join("\n") || "No settings configured.",
    });
  }

  // Session-level overrides
  if (params.sessionId) {
    const sessionParts: string[] = [];
    if (params.sessionProvider) sessionParts.push(`Provider: ${params.sessionProvider}`);
    if (params.sessionModelId) sessionParts.push(`Model: ${params.sessionModelId}`);
    if (params.sessionThinkingLevel) sessionParts.push(`Thinking: ${params.sessionThinkingLevel}`);
    if (sessionParts.length > 0) {
      sections.push({
        kind: "model-settings",
        label: "Session overrides",
        origin: "session",
        scope: "session",
        enabled: true,
        content: sessionParts.join("\n"),
      });
    }
  }

  // 7. User message placeholder
  sections.push({
    kind: "user-message",
    label: "User message",
    origin: "composer",
    scope: "session",
    enabled: true,
    content: "{{USER_MESSAGE}}",
    detail: "Your next message will be inserted here in the prompt chain.",
  });

  return {
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    sections,
  };
}

/**
 * Read context files from the workspace path. Returns undefined for missing files.
 */
export async function readContextFiles(
  workspacePath: string,
): Promise<{ agentsMd?: string; claudeMd?: string }> {
  const result: { agentsMd?: string; claudeMd?: string } = {};
  try {
    result.agentsMd = await readFile(join(workspacePath, "AGENTS.md"), "utf8");
  } catch {
    // file doesn't exist — fine
  }
  try {
    result.claudeMd = await readFile(join(workspacePath, "CLAUDE.md"), "utf8");
  } catch {
    // file doesn't exist — fine
  }
  return result;
}
