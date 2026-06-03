import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode } from "./desktop-state";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly externalTerminalApp: string;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onChooseExternalTerminalApp: () => void;
  readonly onClearExternalTerminalApp: () => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
}

function terminalAppLabel(appPath: string): string {
  if (!appPath) {
    return "Not set";
  }
  const base = appPath.split("/").pop() ?? appPath;
  return base.replace(/\.app$/, "");
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  externalTerminalApp,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onChooseExternalTerminalApp,
  onClearExternalTerminalApp,
  onToggleSkillCommands,
}: SettingsGeneralSectionProps) {
  const connectedCount = runtime?.providers.filter((p) => p.hasAuth).length ?? 0;
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  return (
    <>
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

      <SettingsGroup title="Shortcuts">
        <SettingsInfoRow label="New thread" value="Cmd+Shift+O" />
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
