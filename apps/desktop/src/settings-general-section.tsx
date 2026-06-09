import { useEffect, useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode, PlanModeIdeologySetting } from "./desktop-state";
import type { CavemanLevel, SmartCompactSettings } from "./ipc";
import { buildModelOptions } from "./composer-commands";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";
import { SettingsSmartCompactSection } from "./settings-smart-compact-section";

interface RetrySettings {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly externalTerminalApp: string;
  readonly retrySettings: RetrySettings;
  readonly commitPushModel?: string;
  readonly planModeIdeology: PlanModeIdeologySetting;
  readonly smartCompactSettings: SmartCompactSettings;
  readonly cavemanLevel: CavemanLevel;
  readonly activeView: string;
  readonly queueMode: boolean;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetPlanModeIdeology: (ideology: PlanModeIdeologySetting) => void;
  readonly onSetActiveView: (view: import("./desktop-state").AppView) => void;
  readonly onSetQueueMode: (enabled: boolean) => void;
  readonly onOpenKanban: () => void;
  readonly onSetCommitPushModel: (model: string) => void;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onChooseExternalTerminalApp: () => void;
  readonly onClearExternalTerminalApp: () => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetRetrySettings: (settings: RetrySettings) => void;
  readonly onSetSmartCompactSettings: (settings: Partial<SmartCompactSettings>) => void;
}

function terminalAppLabel(appPath: string): string {
  if (!appPath) {
    return "Not set";
  }
  const base = appPath.split("/").pop() ?? appPath;
  return base.replace(/\.app$/, "");
}

function formatRetryDuration(baseDelayMs: number, maxRetries: number): string {
  const totalMs = baseDelayMs * (2 ** maxRetries - 1);
  const totalSeconds = Math.round(totalMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  externalTerminalApp,
  retrySettings,
  commitPushModel,
  onSetCommitPushModel,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onChooseExternalTerminalApp,
  onClearExternalTerminalApp,
  onToggleSkillCommands,
  onSetRetrySettings,
  planModeIdeology,
  onSetPlanModeIdeology,
  smartCompactSettings,
  onSetSmartCompactSettings,
  cavemanLevel,
  activeView,
  queueMode,
  onSetCavemanLevel,
  onSetActiveView,
  onSetQueueMode,
  onOpenKanban,
}: SettingsGeneralSectionProps) {
  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);

  const connectedCount = runtime?.providers.filter((p) => p.hasAuth).length ?? 0;
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);
  const [retryDraft, setRetryDraft] = useState(retrySettings);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  useEffect(() => {
    setRetryDraft(retrySettings);
  }, [retrySettings]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  const commitRetryDraft = () => {
    if (
      retryDraft.enabled !== retrySettings.enabled ||
      retryDraft.maxRetries !== retrySettings.maxRetries ||
      retryDraft.baseDelayMs !== retrySettings.baseDelayMs
    ) {
      onSetRetrySettings(retryDraft);
    }
  };

  return (
    <>
      <SettingsGroup title="Project view" description="Choose how projects are displayed in the sidebar.">
        <SettingsRow title="View mode" description="Threads shows the conversation list. Queue auto-advances to finished sessions. Kanban organises by status.">
          <div className="settings-pill-row">
            <button
              className={`settings-pill${activeView === "threads" && !queueMode ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={activeView === "threads" && !queueMode}
              onClick={() => { onSetQueueMode(false); onSetActiveView("threads"); }}
            >
              Threads
            </button>
            <button
              className={`settings-pill${queueMode ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={queueMode}
              onClick={() => onSetQueueMode(true)}
            >
              Queue
            </button>
            <button
              className={`settings-pill${activeView === "kanban" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={activeView === "kanban"}
              onClick={() => { onSetQueueMode(false); onOpenKanban(); }}
            >
              Kanban
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="General">
        <SettingsInfoRow
          label="Connected providers"
          value={connectedCount > 0 ? String(connectedCount) : "None"}
        />
        <SettingsInfoRow label="Discovered skills" value={String(runtime?.skills.length ?? 0)} />
        <SettingsRow title="Model settings scope" description="Choose whether model defaults apply everywhere or per repo.">
          <div className="settings-pill-row">
            <button
              className={`settings-pill${modelSettingsScopeMode === "app-global" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "app-global"}
              onClick={() => onSetModelSettingsScopeMode("app-global")}
            >
              App global
            </button>
            <button
              className={`settings-pill${modelSettingsScopeMode === "per-repo" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "per-repo"}
              onClick={() => onSetModelSettingsScopeMode("per-repo")}
            >
              Per repo
            </button>
          </div>
        </SettingsRow>
        <SettingsRow
          title="Caveman level"
          description="Active caveman compression intensity. Toggle with the composer button."
        >
          <select
            aria-label="Caveman level"
            className="settings-text-input"
            value={cavemanLevel === "off" ? "full" : cavemanLevel}
            onChange={(event) => onSetCavemanLevel(event.target.value as CavemanLevel)}
          >
            <option value="lite">Lite</option>
            <option value="full">Full</option>
            <option value="ultra">Ultra</option>
          </select>
        </SettingsRow>
        <SettingsRow title="Enable skill slash commands" description="Keep skill slash commands available in the composer.">
          <input
            aria-label="Enable skill slash commands"
            checked={runtime?.settings.enableSkillCommands ?? true}
            type="checkbox"
            onChange={(event) => onToggleSkillCommands(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title="Shell of integrated terminal" description="Leave blank to use your default login shell.">
          <input
            aria-label="Shell of integrated terminal"
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
        <SettingsRow
          title="External terminal app"
          description="Used by the “Open in external terminal” button to resume a session."
        >
          <div className="settings-pill-row">
            <span className="settings-info-row__value">{terminalAppLabel(externalTerminalApp)}</span>
            <button className="settings-pill" type="button" onClick={onChooseExternalTerminalApp}>
              Choose…
            </button>
            {externalTerminalApp ? (
              <button className="settings-pill" type="button" onClick={onClearExternalTerminalApp}>
                Clear
              </button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Commit message model" description="Model used to generate commit messages when committing and pushing.">
        <SettingsRow title="Model" description="Choose the model for auto-generated commit messages.">
          {modelOptions.length === 0 ? (
            <span className="settings-info-row__value">No models available</span>
          ) : (
            <div className="settings-pill-row" style={{ flexWrap: "wrap" }}>
              {modelOptions.map((option) => {
                const modelString = `${option.providerId}:${option.modelId}`;
                const isActive = commitPushModel === modelString;
                return (
                  <button
                    className={`settings-pill${isActive ? " settings-pill--active" : ""}`}
                    key={modelString}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSetCommitPushModel(modelString)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Plan mode" description="Choose the default planning ideology for Plan mode.">
        <SettingsRow title="Plan ideology" description="Default is a scoped engineering plan. Grill interviews the user relentlessly first.">
          <div className="settings-pill-row">
            <button
              className={`settings-pill${planModeIdeology === "default" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={planModeIdeology === "default"}
              onClick={() => onSetPlanModeIdeology("default")}
            >
              Default
            </button>
            <button
              className={`settings-pill${planModeIdeology === "grill" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={planModeIdeology === "grill"}
              onClick={() => onSetPlanModeIdeology("grill")}
            >
              Grill
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Retry on connection loss" description="Auto-retry when the LLM connection drops or the provider returns an error.">
        <SettingsRow title="Enable auto-retry" description="Automatically retry on transient errors (connection lost, rate limits, server errors).">
          <input
            aria-label="Enable auto-retry"
            checked={retryDraft.enabled}
            type="checkbox"
            onChange={(event) => setRetryDraft({ ...retryDraft, enabled: event.target.checked })}
            onBlur={commitRetryDraft}
          />
        </SettingsRow>
        <SettingsRow title="Max retries" description="Maximum number of retry attempts before giving up.">
          <input
            aria-label="Max retries"
            className="settings-text-input settings-text-input--small"
            type="number"
            min={1}
            max={20}
            value={retryDraft.maxRetries}
            onChange={(event) => {
              const value = Math.max(1, Math.min(20, Number(event.target.value) || 1));
              setRetryDraft({ ...retryDraft, maxRetries: value });
            }}
            onBlur={commitRetryDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
        <SettingsRow title="Base delay (ms)" description="Initial wait time before first retry. Doubles with each attempt.">
          <input
            aria-label="Base delay in milliseconds"
            className="settings-text-input settings-text-input--small"
            type="number"
            min={500}
            max={60000}
            step={500}
            value={retryDraft.baseDelayMs}
            onChange={(event) => {
              const value = Math.max(500, Math.min(60000, Number(event.target.value) || 2000));
              setRetryDraft({ ...retryDraft, baseDelayMs: value });
            }}
            onBlur={commitRetryDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
        <SettingsInfoRow
          label="Total retry window"
          value={retryDraft.enabled ? formatRetryDuration(retryDraft.baseDelayMs, retryDraft.maxRetries) : "Disabled"}
        />
      </SettingsGroup>

      <SettingsSmartCompactSection
        runtime={runtime}
        settings={smartCompactSettings}
        onSetSettings={onSetSmartCompactSettings}
      />

      <SettingsGroup title="Shortcuts">
        <SettingsInfoRow label="New project" value="Cmd+Shift+O" />
        <SettingsInfoRow label="Open settings" value="Cmd+," />
        <SettingsInfoRow label="Toggle terminal" value="Cmd+J" />
        <SettingsInfoRow label="Commit &amp; push" value="Cmd+Shift+K" />
        <SettingsInfoRow label="New terminal tab" value="Cmd+T (in terminal)" />
        <SettingsInfoRow label="Cycle model" value="Cmd+T" />
        <SettingsInfoRow label="Cycle thinking" value="Shift+Tab" />
        <SettingsInfoRow label="Send message" value="Enter" />
        <SettingsInfoRow label="New line" value="Shift+Enter" />
      </SettingsGroup>
    </>
  );
}
