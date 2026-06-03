import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { SubagentAgentRecord, SubagentSettingsRecord, DesktopAppState } from "../src/desktop-state";
import type { AppStoreInternals } from "./app-store-internals";

/* ── Private helpers ─────────────────────────────────────────────── */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function setOptionalEnv(name: string, enabled: boolean): void {
  if (enabled) process.env[name] = "1";
  else delete process.env[name];
}

/* ── Exported free helpers ──────────────────────────────────────── */

export function defaultSubagentPiCommand(): string {
  try {
    const packageJson = require.resolve("@earendil-works/pi-coding-agent/package.json");
    const cliPath = join(dirname(packageJson), "dist/cli.js");
    return `/usr/bin/env ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
  } catch {
    return "pi";
  }
}

export function applySubagentEnvironment(settings: SubagentSettingsRecord): void {
  process.env.PI_SUBAGENT_PI_COMMAND = settings.piCommandOverride.trim() || defaultSubagentPiCommand();
  setOptionalEnv("PI_ORCHESTRATOR_MODE", settings.orchestratorMode);
  setOptionalEnv("PI_SUBAGENT_DISABLE_COORDINATOR_ONLY_TURN", settings.disableCoordinatorOnlyTurn);
  setOptionalEnv("PI_SUBAGENT_DISABLE_CHILD_CONTEXT_BOUNDARY", settings.disableChildContextBoundary);
  setOptionalEnv("PI_SUBAGENT_DISABLE_SESSION_TITLES", settings.disableSessionTitles);
  if (settings.mux === "auto") delete process.env.PI_SUBAGENT_MUX;
  else process.env.PI_SUBAGENT_MUX = settings.mux;
}

export function getSubagentGlobalAgentsDir(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "agents");
}

export function parseSubagentAgentFile(filePath: string, raw: string, scope: "project" | "global"): SubagentAgentRecord {
  const nameFromFile = basename(filePath, ".md");
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields = new Map<string, string>();
  if (frontmatter) {
    for (const line of frontmatter[1]?.split(/\r?\n/) ?? []) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match?.[1]) fields.set(match[1], (match[2] ?? "").trim().replace(/^['\"]|['\"]$/g, ""));
    }
  }
  const mode = fields.get("mode");
  const sessionMode = fields.get("session-mode");
  return {
    id: filePath,
    name: fields.get("name") || nameFromFile,
    ...(fields.get("description") ? { description: fields.get("description") } : {}),
    ...(fields.get("model") ? { model: fields.get("model") } : {}),
    ...(fields.get("thinking") ? { thinking: fields.get("thinking") } : {}),
    ...(mode === "interactive" || mode === "background" ? { mode } : {}),
    ...(fields.get("async") === "true" ? { async: true } : fields.get("async") === "false" ? { async: false } : {}),
    ...(fields.get("auto-exit") === "true" ? { autoExit: true } : fields.get("auto-exit") === "false" ? { autoExit: false } : {}),
    ...(sessionMode === "standalone" || sessionMode === "lineage-only" || sessionMode === "fork" ? { sessionMode } : {}),
    ...(fields.get("allow-model-override") === "true" ? { allowModelOverride: true } : fields.get("allow-model-override") === "false" ? { allowModelOverride: false } : {}),
    filePath,
    scope,
    raw,
  };
}

/* ── Directory scan helpers ──────────────────────────────────────── */

export async function readSubagentAgentsFromDir(
  dir: string,
  scope: "project" | "global",
  agents: Map<string, SubagentAgentRecord>,
): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  } catch {
    return;
  }
  for (const file of files.sort()) {
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, "utf8");
      const agent = parseSubagentAgentFile(filePath, raw, scope);
      agents.set(agent.name, agent);
    } catch {
      // Skip unreadable agent files but keep settings surface usable.
    }
  }
}

export async function reloadSubagentAgentsForWorkspace(
  store: AppStoreInternals,
  workspaceId: string,
  workspacePath?: string,
): Promise<void> {
  const workspace = store.state.workspaces.find((entry) => entry.id === workspaceId);
  const path = workspacePath ?? workspace?.path;
  if (!path) return;
  const agents = new Map<string, SubagentAgentRecord>();
  await readSubagentAgentsFromDir(getSubagentGlobalAgentsDir(), "global", agents);
  await readSubagentAgentsFromDir(join(path, ".pi", "agents"), "project", agents);
  store.state = {
    ...store.state,
    subagentAgentsByWorkspace: {
      ...store.state.subagentAgentsByWorkspace,
      [workspaceId]: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/* ── Store-dependent methods ─────────────────────────────────────── */

export async function setSubagentSettings(
  store: AppStoreInternals,
  settings: Partial<SubagentSettingsRecord>,
): Promise<DesktopAppState> {
  await store.initialize();
  store.state = {
    ...store.state,
    subagentSettings: {
      ...store.state.subagentSettings,
      ...settings,
      piCommandOverride: settings.piCommandOverride?.trim() ?? store.state.subagentSettings.piCommandOverride,
    },
  };
  applySubagentEnvironment(store.state.subagentSettings);
  await store.persistUiState();
  return store.emit();
}

export async function refreshSubagentAgents(
  store: AppStoreInternals,
  workspaceId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  await reloadSubagentAgentsForWorkspace(store, workspaceId);
  return store.emit();
}

export async function saveSubagentAgent(
  store: AppStoreInternals,
  workspaceId: string,
  input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" },
): Promise<DesktopAppState> {
  await store.initialize();
  const workspace = store.state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return store.withError(`Unknown workspace: ${workspaceId}`);
  const name = input.name.trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) return store.withError("Agent name must be lower-kebab-case.");
  const scope = input.scope ?? "project";
  const agentPath = scope === "global"
    ? join(getSubagentGlobalAgentsDir(), `${name}.md`)
    : join(workspace.path, ".pi", "agents", `${name}.md`);
  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, input.raw, "utf8");
  await reloadSubagentAgentsForWorkspace(store, workspaceId);
  await store.refreshRuntime(workspaceId);
  return store.emit();
}

export async function deleteSubagentAgent(
  store: AppStoreInternals,
  workspaceId: string,
  name: string,
  scope: "project" | "global" = "project",
): Promise<DesktopAppState> {
  await store.initialize();
  const workspace = store.state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return store.withError(`Unknown workspace: ${workspaceId}`);
  const agentPath = scope === "global"
    ? join(getSubagentGlobalAgentsDir(), `${name}.md`)
    : join(workspace.path, ".pi", "agents", `${name}.md`);
  await rm(agentPath, { force: true });
  await reloadSubagentAgentsForWorkspace(store, workspaceId);
  await store.refreshRuntime(workspaceId);
  return store.emit();
}
