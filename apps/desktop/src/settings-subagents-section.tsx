import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { SubagentAgentRecord, SubagentSettingsRecord, WorkspaceRecord } from "./desktop-state";
import { SettingsGroup, SettingsRow, settingsPill } from "./settings-utils";

const DEFAULT_AGENT_TEMPLATE = `---
name: new-agent
description: What this agent is good at
model: 
thinking: medium
allow-model-override: true
mode: background
async: true
auto-exit: true
session-mode: lineage-only
---

You are a focused helper agent.

Return a concise summary when done.
`;

function setFrontmatterField(raw: string, key: string, value: string): string {
  const normalizedValue = value.trim();
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatter) {
    return `---\n${key}: ${normalizedValue}\n---\n\n${raw}`;
  }
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

export function SettingsSubagentsSection({
  workspace,
  settings,
  agents,
  onSetSettings,
  onRefreshAgents,
  runtime,
  onSaveAgent,
  onDeleteAgent,
}: Props) {
  const workspaceId = workspace?.id;
  const availableModels = runtime?.models.filter((model) => model.available) ?? [];

  return (
    <>
      <SettingsGroup title="Subagents" description="Configure the pi-subagents extension used by child agents.">
        <SettingsRow title="Pi command" description="Command used when the extension launches a background child. Leave empty for peche-pi's bundled Pi command.">
          <input
            className="settings-input"
            placeholder="Bundled Pi command"
            value={settings.piCommandOverride}
            onChange={(event) => onSetSettings({ piCommandOverride: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow title="Orchestrator mode" description="Limit the parent to delegation-only tools and use the extension's orchestrator prompt.">
          <button className={settingsPill(settings.orchestratorMode)} type="button" onClick={() => onSetSettings({ orchestratorMode: !settings.orchestratorMode })}>
            {settings.orchestratorMode ? "Enabled" : "Disabled"}
          </button>
        </SettingsRow>
        <SettingsRow title="Mux backend" description="Force a terminal multiplexer for interactive subagents, or leave on auto.">
          <select className="settings-select" value={settings.mux} onChange={(event) => onSetSettings({ mux: event.target.value as SubagentSettingsRecord["mux"] })}>
            <option value="auto">Auto</option>
            <option value="cmux">cmux</option>
            <option value="tmux">tmux</option>
            <option value="zellij">zellij</option>
            <option value="wezterm">WezTerm</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Coordinator turn" description="When enabled, parent keeps running after async subagent launches instead of stopping for the child's later result.">
          <button className={settingsPill(settings.disableCoordinatorOnlyTurn)} type="button" onClick={() => onSetSettings({ disableCoordinatorOnlyTurn: !settings.disableCoordinatorOnlyTurn })}>
            {settings.disableCoordinatorOnlyTurn ? "Continue parent" : "Stop after launch"}
          </button>
        </SettingsRow>
        <SettingsRow title="Fork boundary" description="Disable the child-context boundary marker for raw forked sessions.">
          <button className={settingsPill(settings.disableChildContextBoundary)} type="button" onClick={() => onSetSettings({ disableChildContextBoundary: !settings.disableChildContextBoundary })}>
            {settings.disableChildContextBoundary ? "Disabled" : "Enabled"}
          </button>
        </SettingsRow>
        <SettingsRow title="Session titles" description="Disable automatic child session titles from the extension.">
          <button className={settingsPill(settings.disableSessionTitles)} type="button" onClick={() => onSetSettings({ disableSessionTitles: !settings.disableSessionTitles })}>
            {settings.disableSessionTitles ? "Disabled" : "Enabled"}
          </button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Agent manager" description="Global agents live in ~/.pi/agent/agents/*.md; project agents live in .pi/agents/*.md and override globals by name.">
        <div className="settings-row settings-row--stacked">
          <div className="settings-row__body">
            <div className="settings-row__title">Subagent roster</div>
            <div className="settings-row__description">{workspace ? `Global agents plus project overrides for ${workspace.path}` : "Select a workspace to manage agents."}</div>
          </div>
          <div className="settings-inline-actions">
            {workspaceId ? <button className="button button--secondary" type="button" onClick={() => onRefreshAgents(workspaceId)}>Refresh</button> : null}
            {workspaceId ? <button className="button button--primary" type="button" onClick={() => onSaveAgent(workspaceId, { name: "new-agent", raw: DEFAULT_AGENT_TEMPLATE })}>New agent</button> : null}
          </div>
        </div>
        {agents.length === 0 ? (
          <p className="settings-hint">No global or project agents found yet.</p>
        ) : (
          <div className="subagent-settings-list">
            {agents.map((agent) => (
              <AgentEditor
                agent={agent}
                key={agent.filePath}
                workspaceId={workspaceId}
                availableModels={availableModels}
                onSaveAgent={onSaveAgent}
                onDeleteAgent={onDeleteAgent}
              />
            ))}
          </div>
        )}
      </SettingsGroup>
    </>
  );
}

function AgentEditor({
  agent,
  workspaceId,
  availableModels,
  onSaveAgent,
  onDeleteAgent,
}: {
  readonly agent: SubagentAgentRecord;
  readonly availableModels: NonNullable<RuntimeSnapshot["models"]>;
  readonly workspaceId?: string;
  readonly onSaveAgent: Props["onSaveAgent"];
  readonly onDeleteAgent: Props["onDeleteAgent"];
}) {
  const [draftRaw, setDraftRaw] = useState(agent.raw);

  useEffect(() => {
    setDraftRaw(agent.raw);
  }, [agent.raw]);

  const saveRaw = (raw: string) => {
    setDraftRaw(raw);
    if (workspaceId) onSaveAgent(workspaceId, { name: agent.name, raw, scope: agent.scope });
  };

  return (
    <details className="subagent-settings-agent">
      <summary>
        <span className="subagent-settings-agent__name">{agent.name}</span>
        <span className={settingsPill(agent.scope === "project")}>{agent.scope}</span>
        {agent.description ? <span className="subagent-settings-agent__description">{agent.description}</span> : null}
        {agent.model ? <span className={settingsPill(true)}>{agent.model}</span> : null}
      </summary>
      <div className="subagent-settings-agent__controls">
        <label>
          <span>Model</span>
          <select
            className="settings-select"
            value={agent.model ?? ""}
            onChange={(event) => saveRaw(setFrontmatterField(draftRaw, "model", event.target.value))}
          >
            <option value="">Inherit parent/default model</option>
            {availableModels.map((model) => {
              const value = `${model.providerId}/${model.modelId}`;
              return (
                <option key={value} value={value}>
                  {model.providerName} · {model.label}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span>Thinking</span>
          <select
            className="settings-select"
            value={agent.thinking ?? ""}
            onChange={(event) => saveRaw(setFrontmatterField(draftRaw, "thinking", event.target.value))}
          >
            <option value="">Inherit parent/default thinking</option>
            <option value="off">Off</option>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X-high</option>
          </select>
        </label>
        <label className="subagent-settings-agent__toggle">
          <input
            type="checkbox"
            checked={agent.allowModelOverride !== false}
            onChange={(event) => saveRaw(setFrontmatterField(draftRaw, "allow-model-override", event.target.checked ? "true" : "false"))}
          />
          <span>Allow launch-time model override</span>
        </label>
      </div>
      <textarea
        className="settings-textarea subagent-settings-agent__raw"
        value={draftRaw}
        onChange={(event) => setDraftRaw(event.target.value)}
        rows={14}
        onBlur={(event) => saveRaw(event.target.value)}
      />
      <div className="settings-inline-actions">
        <span className="settings-hint">Saves on blur · {agent.filePath}</span>
        {workspaceId ? <button className="button button--danger" type="button" onClick={() => onDeleteAgent(workspaceId, agent.name, agent.scope)}>Delete</button> : null}
      </div>
    </details>
  );
}
