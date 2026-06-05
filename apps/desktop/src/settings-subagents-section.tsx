import { useEffect, useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { SubagentAgentRecord, SubagentSettingsRecord, WorkspaceRecord } from "./desktop-state";
import { SettingsGroup, SettingsRow, settingsPill } from "./settings-utils";

const DEFAULT_AGENT_TEMPLATE = `---
name: new-agent
description: What this agent is good at
enabled: true
tools: read, bash
model: 
thinking: medium
allow-model-override: true
mode: background
async: true
auto-exit: true
session-mode: lineage-only
system-prompt: replace
---

You are a focused helper agent.

Return a concise summary when done.
`;

const FALLBACK_TOOLS = ["read", "bash", "edit", "write", "web_search", "web_fetch", "subagent"];

function setFrontmatterField(raw: string, key: string, value: string): string {
  const normalizedValue = value.trim();
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) return `---\n${key}: ${normalizedValue}\n---\n\n${raw}`;
  const body = raw.slice(frontmatter[0].length);
  const lines = (frontmatter[1] ?? "").split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`))) {
      replaced = true;
      return `${key}: ${normalizedValue}`;
    }
    return line;
  });
  if (!replaced) nextLines.push(`${key}: ${normalizedValue}`);
  return `---\n${nextLines.join("\n")}\n---\n${body}`;
}

function setFrontmatterFields(raw: string, fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields).reduce((nextRaw, [key, value]) => setFrontmatterField(nextRaw, key, value), raw);
}

interface Props {
  readonly workspace?: WorkspaceRecord;
  readonly settings: SubagentSettingsRecord;
  readonly agents: readonly SubagentAgentRecord[];
  readonly runtime?: RuntimeSnapshot;
  readonly onSetSettings: (settings: Partial<SubagentSettingsRecord>) => void;
  readonly onRefreshAgents: (workspaceId: string) => void;
  readonly onSaveAgent: (workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }) => void;
  readonly onDeleteAgent: (workspaceId: string, name: string, scope?: "project" | "global") => void;
}

export function SettingsSubagentsSection({ workspace, settings, agents, onSetSettings, onRefreshAgents, runtime, onSaveAgent, onDeleteAgent }: Props) {
  const workspaceId = workspace?.id;
  const availableModels = runtime?.models.filter((model) => model.available) ?? [];
  const availableTools = useMemo(() => {
    const names = new Set(FALLBACK_TOOLS);
    for (const extension of runtime?.extensions ?? []) for (const tool of extension.tools) names.add(tool);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [runtime?.extensions]);

  return (
    <>
      <SettingsGroup title="General subagent settings" description="Configure the pi-subagents extension used by child agents.">
        <SettingsRow title="Pi command" description="Command used when extension launches child Pi. Empty uses bundled Pi command.">
          <input className="settings-input" placeholder="Bundled Pi command" value={settings.piCommandOverride} onChange={(event) => onSetSettings({ piCommandOverride: event.target.value })} />
        </SettingsRow>
        <SettingsRow title="Orchestrator mode" description="Limit parent to delegation-only tools and use orchestrator prompt.">
          <button className={settingsPill(settings.orchestratorMode)} type="button" onClick={() => onSetSettings({ orchestratorMode: !settings.orchestratorMode })}>{settings.orchestratorMode ? "Enabled" : "Disabled"}</button>
        </SettingsRow>
        <SettingsRow title="Mux backend" description="Force terminal multiplexer for interactive subagents, or leave auto.">
          <select className="settings-select" value={settings.mux} onChange={(event) => onSetSettings({ mux: event.target.value as SubagentSettingsRecord["mux"] })}>
            <option value="auto">Auto</option><option value="cmux">cmux</option><option value="tmux">tmux</option><option value="zellij">zellij</option><option value="wezterm">WezTerm</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Coordinator turn" description="When enabled, parent continues after async subagent launch.">
          <button className={settingsPill(settings.disableCoordinatorOnlyTurn)} type="button" onClick={() => onSetSettings({ disableCoordinatorOnlyTurn: !settings.disableCoordinatorOnlyTurn })}>{settings.disableCoordinatorOnlyTurn ? "Continue parent" : "Stop after launch"}</button>
        </SettingsRow>
        <SettingsRow title="Fork boundary" description="Disable child-context boundary marker for raw forked sessions.">
          <button className={settingsPill(settings.disableChildContextBoundary)} type="button" onClick={() => onSetSettings({ disableChildContextBoundary: !settings.disableChildContextBoundary })}>{settings.disableChildContextBoundary ? "Disabled" : "Enabled"}</button>
        </SettingsRow>
        <SettingsRow title="Session titles" description="Disable automatic child session titles from extension.">
          <button className={settingsPill(settings.disableSessionTitles)} type="button" onClick={() => onSetSettings({ disableSessionTitles: !settings.disableSessionTitles })}>{settings.disableSessionTitles ? "Disabled" : "Enabled"}</button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Agent manager" description="Global agents live in ~/.pi/agent/agents/*.md; project agents live in .pi/agents/*.md and override globals by name.">
        <div className="settings-row settings-row--stacked">
          <div className="settings-row__body"><div className="settings-row__title">Subagent roster</div><div className="settings-row__description">{workspace ? `Global agents plus project overrides for ${workspace.path}` : "Select a workspace to edit agents. General settings still apply globally."}</div></div>
          <div className="settings-inline-actions">{workspaceId ? <button className="button button--secondary" type="button" onClick={() => onRefreshAgents(workspaceId)}>Refresh</button> : null}{workspaceId ? <button className="button button--primary" type="button" onClick={() => onSaveAgent(workspaceId, { name: "new-agent", raw: DEFAULT_AGENT_TEMPLATE })}>New agent</button> : null}</div>
        </div>
        {agents.length === 0 ? <p className="settings-hint">No global or project agents found yet.</p> : (
          <div className="subagent-settings-list">{agents.map((agent) => <AgentEditor agent={agent} key={agent.filePath} workspaceId={workspaceId} availableModels={availableModels} availableTools={availableTools} onSaveAgent={onSaveAgent} onDeleteAgent={onDeleteAgent} />)}</div>
        )}
      </SettingsGroup>
    </>
  );
}

function AgentEditor({ agent, workspaceId, availableModels, availableTools, onSaveAgent, onDeleteAgent }: {
  readonly agent: SubagentAgentRecord;
  readonly availableModels: NonNullable<RuntimeSnapshot["models"]>;
  readonly availableTools: readonly string[];
  readonly workspaceId?: string;
  readonly onSaveAgent: Props["onSaveAgent"];
  readonly onDeleteAgent: Props["onDeleteAgent"];
}) {
  const [draftRaw, setDraftRaw] = useState(agent.raw);
  useEffect(() => setDraftRaw(agent.raw), [agent.raw]);

  const saveRaw = (raw: string) => {
    setDraftRaw(raw);
    if (workspaceId) onSaveAgent(workspaceId, { name: agent.name, raw, scope: agent.scope });
  };
  const setField = (key: string, value: string) => saveRaw(setFrontmatterField(draftRaw, key, value));
  const setTool = (tool: string, enabled: boolean) => {
    const tools = new Set(agent.tools ?? []);
    if (enabled) tools.add(tool); else tools.delete(tool);
    setField("tools", Array.from(tools).sort((a, b) => a.localeCompare(b)).join(", "));
  };

  return (
    <details className="subagent-settings-agent">
      <summary>
        <span className="subagent-settings-agent__name">{agent.name}</span>
        <span className={settingsPill(agent.enabled !== false)}>{agent.enabled === false ? "disabled" : "enabled"}</span>
        <span className={settingsPill(agent.scope === "project")}>{agent.scope}</span>
        {agent.description ? <span className="subagent-settings-agent__description">{agent.description}</span> : null}
        {agent.model ? <span className={settingsPill(true)}>{agent.model}</span> : null}
      </summary>
      <div className="subagent-settings-agent__controls">
        <label><span>Name</span><input className="settings-input" value={agent.name} onChange={(event) => saveRaw(setFrontmatterFields(draftRaw, { name: event.target.value, description: agent.description ?? "" }))} /></label>
        <label><span>Description</span><input className="settings-input" value={agent.description ?? ""} onChange={(event) => setField("description", event.target.value)} /></label>
        <label className="subagent-settings-agent__toggle"><input type="checkbox" checked={agent.enabled !== false} onChange={(event) => setField("enabled", event.target.checked ? "true" : "false")} /><span>Enabled</span></label>
        <label><span>Model</span><select className="settings-select" value={agent.model ?? ""} onChange={(event) => setField("model", event.target.value)}><option value="">Inherit parent/default model</option>{availableModels.map((model) => { const value = `${model.providerId}/${model.modelId}`; return <option key={value} value={value}>{model.providerName} · {model.label}</option>; })}</select></label>
        <label><span>Thinking</span><select className="settings-select" value={agent.thinking ?? ""} onChange={(event) => setField("thinking", event.target.value)}><option value="">Inherit parent/default thinking</option><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">X-high</option></select></label>
        <label><span>Launch mode</span><select className="settings-select" value={agent.mode ?? "background"} onChange={(event) => setField("mode", event.target.value)}><option value="background">Background</option><option value="interactive">Interactive</option></select></label>
        <label><span>Session mode</span><select className="settings-select" value={agent.sessionMode ?? "lineage-only"} onChange={(event) => setField("session-mode", event.target.value)}><option value="standalone">Standalone</option><option value="lineage-only">Lineage only</option><option value="fork">Fork</option></select></label>
        <label><span>System prompt</span><select className="settings-select" value={agent.systemPromptMode ?? "replace"} onChange={(event) => setField("system-prompt", event.target.value)}><option value="replace">Replace</option><option value="append">Append</option><option value="prepend">Prepend</option></select></label>
        <label className="subagent-settings-agent__toggle"><input type="checkbox" checked={agent.async !== false} onChange={(event) => setField("async", event.target.checked ? "true" : "false")} /><span>Async result delivery</span></label>
        <label className="subagent-settings-agent__toggle"><input type="checkbox" checked={agent.autoExit !== false} onChange={(event) => setField("auto-exit", event.target.checked ? "true" : "false")} /><span>Auto-exit when complete</span></label>
        <label className="subagent-settings-agent__toggle"><input type="checkbox" checked={agent.allowModelOverride !== false} onChange={(event) => setField("allow-model-override", event.target.checked ? "true" : "false")} /><span>Allow launch-time model override</span></label>
      </div>
      <div className="subagent-settings-agent__tools">
        <div className="settings-row__title">Tools</div>
        <div className="settings-row__description">No tools selected means extension default. Select exact tools to restrict agent access.</div>
        <div className="subagent-settings-agent__tool-grid">{availableTools.map((tool) => <label key={tool} className="subagent-settings-agent__toggle"><input type="checkbox" checked={(agent.tools ?? []).includes(tool)} onChange={(event) => setTool(tool, event.target.checked)} /><span>{tool}</span></label>)}</div>
      </div>
      <details><summary>Edit raw agent file</summary><textarea className="settings-textarea subagent-settings-agent__raw" value={draftRaw} onChange={(event) => setDraftRaw(event.target.value)} rows={14} onBlur={(event) => saveRaw(event.target.value)} /></details>
      <div className="settings-inline-actions"><span className="settings-hint">Saves on change/blur · {agent.filePath}</span>{workspaceId ? <button className="button button--danger" type="button" onClick={() => onDeleteAgent(workspaceId, agent.name, agent.scope)}>Delete</button> : null}</div>
    </details>
  );
}
