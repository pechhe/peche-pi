import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  ContextSection,
  ContextSnapshot,
} from "../src/desktop-state";

/**
 * Estimate token count for a text string.
 * Uses ~4 chars per token as a rough approximation for English text.
 * This is a simplification but gives a good ballpark for analysis.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Build the graphify append system prompt if graphify-out exists.
 * Replicates logic from session-supervisor.ts.
 */
async function buildGraphifyAppendSystemPrompt(workspacePath: string): Promise<string | undefined> {
  const graphPath = resolve(workspacePath, "graphify-out", "graph.json");
  const reportPath = resolve(workspacePath, "graphify-out", "GRAPH_REPORT.md");
  try {
    await access(graphPath);
  } catch {
    return undefined;
  }

  const report = await readFile(reportPath, "utf8").catch(() => "");
  const builtCommit = report.match(/Built from commit:\s*`?([a-f0-9]{7,40})`?/i)?.[1];
  const communities = extractGraphifyCommunityNames(report).slice(0, 8);
  return [
    "# Graphify Project Map",
    "",
    "This workspace has `graphify-out/graph.json`. For natural-language questions about architecture, ownership, file relationships, codebase concepts, or where something fits, use Graphify before grep/search.",
    "",
    "Preferred routing:",
    "- Use `graphify_query` for broad architecture/codebase questions.",
    "- Use `graphify_explain` for a named concept or community.",
    "- Use `graphify_path` to trace connections between two concepts.",
    "- Use Cymbal for exact symbols, refs, impact, implementations, and targeted source reads.",
    "- Use grep/rg for exact strings, config values, logs, or non-code text.",
    "",
    "Fast path: if the user asks how the codebase works and does not explicitly ask to rebuild/update, query the existing graph first. Do not redetect or rebuild before answering.",
    "",
    builtCommit ? `Graph built from commit: ${builtCommit}` : undefined,
    communities.length ? `Top graph communities: ${communities.join(", ")}` : undefined,
    "If current source changes matter, check graph freshness and run `graphify_update` before relying on the graph.",
  ].filter(Boolean).join("\n");
}

function extractGraphifyCommunityNames(report: string): string[] {
  const names: string[] = [];
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/^- \[\[_COMMUNITY_([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (match?.[1]) {
      names.push((match[2] || match[1]).trim());
    }
  }
  return names;
}

/**
 * Build the base system prompt content (without context files or skills).
 * Context files and skills are shown separately for accurate token analysis.
 */
async function buildBaseSystemPromptContent(params: {
  readonly workspacePath: string;
  readonly runtime?: RuntimeSnapshot;
}): Promise<string> {
  const { workspacePath, runtime: _runtime } = params;
  const promptCwd = workspacePath.replace(/\\/g, "/");
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Base system prompt (default pi prompt)
  let prompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement
- write: Create or overwrite files

Guidelines:
- Use bash for file operations like ls, rg, find
- Be concise in your responses
- Show file paths clearly when working with files`;

  // Date and working directory
  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}

/**
 * Build a ContextSnapshot from first-party runtime data and workspace files.
 *
 * This is a pure data transform — no side-effects, fully testable.
 */
export async function buildContextSnapshot(params: {
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
}): Promise<ContextSnapshot> {
  const sections: ContextSection[] = [];

  // Build graphify append prompt if available
  const graphifyPrompt = params.workspacePath
    ? await buildGraphifyAppendSystemPrompt(params.workspacePath)
    : undefined;

  // 1. System prompt - base prompt only (context files and skills shown separately)
  const systemPromptContent = await buildBaseSystemPromptContent({
    workspacePath: params.workspacePath,
    runtime: params.runtime,
  });
  // Append graphify prompt to system prompt for display
  const fullSystemPrompt = graphifyPrompt
    ? `${systemPromptContent}\n\n${graphifyPrompt}`
    : systemPromptContent;

  sections.push({
    kind: "system-prompt",
    label: "System prompt",
    origin: "pi runtime",
    scope: "global",
    enabled: true,
    content: fullSystemPrompt,
    tokenCount: estimateTokens(fullSystemPrompt),
  });

  // 2. Context files (AGENTS.md, CLAUDE.md)
  // Deduplicate - they're often the same file (CLAUDE.md -> AGENTS.md symlink)
  const hasAgentsMd = !!params.agentsMd;
  const hasClaudeMd = !!params.claudeMd;
  const areSameContent = hasAgentsMd && hasClaudeMd && params.agentsMd === params.claudeMd;

  if (hasAgentsMd) {
    sections.push({
      kind: "context-file",
      label: areSameContent ? "AGENTS.md / CLAUDE.md" : "AGENTS.md",
      origin: "workspace",
      scope: "project",
      enabled: true,
      path: join(params.workspacePath, "AGENTS.md"),
      content: params.agentsMd,
      tokenCount: estimateTokens(params.agentsMd),
    });
  }
  if (hasClaudeMd && !areSameContent) {
    sections.push({
      kind: "context-file",
      label: "CLAUDE.md",
      origin: "workspace",
      scope: "project",
      enabled: true,
      path: join(params.workspacePath, "CLAUDE.md"),
      content: params.claudeMd,
      tokenCount: estimateTokens(params.claudeMd),
    });
  }

  // 3. Skills
  const skills = params.runtime?.skills ?? [];
  for (const skill of skills) {
    const skillContent = skill.description || "";
    sections.push({
      kind: "skill",
      label: skill.name,
      origin: skill.source,
      scope: skill.source,
      enabled: skill.enabled,
      path: skill.filePath,
      detail: skill.description,
      tokenCount: estimateTokens(skillContent),
    });
  }

  // 4. Extensions and tools
  const extensions = params.runtime?.extensions ?? [];
  for (const ext of extensions) {
    const toolNames = ext.tools.join(", ");
    const extContent = toolNames ? `Tools: ${toolNames}` : ext.commands.join(", ");
    sections.push({
      kind: "extension",
      label: ext.displayName,
      origin: ext.sourceInfo.source,
      scope: ext.sourceInfo.scope,
      enabled: ext.enabled,
      path: ext.path,
      detail: extContent,
      tokenCount: estimateTokens(extContent),
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
      tokenCount: estimateTokens(cmd.name),
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
    const settingsContent = parts.join("\n") || "No settings configured.";
    sections.push({
      kind: "model-settings",
      label: "Runtime settings",
      origin: "settings",
      scope: "project",
      enabled: true,
      content: settingsContent,
      tokenCount: estimateTokens(settingsContent),
    });
  }

  // Session-level overrides
  if (params.sessionId) {
    const sessionParts: string[] = [];
    if (params.sessionProvider) sessionParts.push(`Provider: ${params.sessionProvider}`);
    if (params.sessionModelId) sessionParts.push(`Model: ${params.sessionModelId}`);
    if (params.sessionThinkingLevel) sessionParts.push(`Thinking: ${params.sessionThinkingLevel}`);
    if (sessionParts.length > 0) {
      const sessionContent = sessionParts.join("\n");
      sections.push({
        kind: "model-settings",
        label: "Session overrides",
        origin: "session",
        scope: "session",
        enabled: true,
        content: sessionContent,
        tokenCount: estimateTokens(sessionContent),
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
    tokenCount: 0, // Not counted until user types
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
