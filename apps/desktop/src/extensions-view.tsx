import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import type { ExtensionConfigSchema, ExtensionConfigField, ExtensionConfigValue } from "./ipc";
import { ExtensionIcon, FolderIcon, RefreshIcon } from "./icons";
import { playButtonClick, playButtonSecondary } from "./button-click-sound";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
  readonly onDeleteExtension: (filePath: string) => void;
  readonly onAnalyzeExtensionConfig?: (extensionPath: string, model?: string) => Promise<ExtensionConfigSchema>;
  readonly onGetExtensionConfig?: (extensionPath: string) => Promise<ExtensionConfigSchema | null>;
  readonly onSetExtensionConfig?: (extensionPath: string, values: readonly ExtensionConfigValue[]) => Promise<void>;
  readonly onInstallExtension?: (source: string, local?: boolean) => Promise<{ success: boolean; message: string }>;
  readonly onUninstallExtension?: (source: string, local?: boolean) => Promise<{ success: boolean; message: string }>;
  readonly availableModels?: readonly string[];
  readonly defaultAnalysisModel?: string;
}

export function ExtensionsView({
  workspace,
  runtime,
  commandCompatibility = [],
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
  onDeleteExtension,
  onAnalyzeExtensionConfig,
  onGetExtensionConfig,
  onSetExtensionConfig,
  onInstallExtension,
  onUninstallExtension: _onUninstallExtension,
  availableModels = [],
  defaultAnalysisModel = "deepseek:deepseek-chat",
}: ExtensionsViewProps) {
  const [query, setQuery] = useState("");
  const [selectedExtensionPath, setSelectedExtensionPath] = useState<string | undefined>();
  const [extensionConfig, setExtensionConfig] = useState<ExtensionConfigSchema | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [configDraft, setConfigDraft] = useState<Record<string, string | number | boolean>>({});
  const [installSource, setInstallSource] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [installLocal, setInstallLocal] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [analysisModel, setAnalysisModel] = useState(defaultAnalysisModel);
  const extensions = useMemo(() => runtime?.extensions ?? [], [runtime?.extensions]);

  // Merge extensions from the same source (e.g. npm package with commands + tools entry points)
  const mergedExtensions = useMemo(() => {
    const bySource = new Map<string, RuntimeExtensionRecord[]>();
    for (const ext of extensions) {
      const key = ext.sourceInfo.source || ext.path;
      const group = bySource.get(key);
      if (group) {
        group.push(ext);
      } else {
        bySource.set(key, [ext]);
      }
    }
    return [...bySource.values()].flatMap((group) => {
      if (group.length === 0) return [];
      if (group.length === 1) return [group[0]!];
      // Merge: use first entry as base, combine commands/tools/flags/shortcuts/diagnostics
      const primary = group[0]!;
      return [{
        path: primary.path,
        displayName: primary.displayName,
        enabled: primary.enabled,
        sourceInfo: primary.sourceInfo,
        commands: [...new Set(group.flatMap((e) => e.commands))].sort(),
        tools: [...new Set(group.flatMap((e) => e.tools))].sort(),
        flags: [...new Set(group.flatMap((e) => e.flags))].sort(),
        shortcuts: [...new Set(group.flatMap((e) => e.shortcuts))].sort(),
        diagnostics: group.flatMap((e) => e.diagnostics),
      } satisfies RuntimeExtensionRecord];
    });
  }, [extensions]);

  const filteredExtensions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return mergedExtensions;
    }

    return mergedExtensions.filter((extension) =>
      [
        extension.displayName,
        extension.path,
        extension.sourceInfo.source,
        extension.sourceInfo.scope,
        extension.sourceInfo.origin,
        ...extension.commands,
        ...extension.tools,
        ...extension.flags,
        ...extension.shortcuts,
        ...extension.diagnostics.map((diagnostic) => diagnostic.message),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [mergedExtensions, query]);
  const globalExtensions = useMemo(
    () => filteredExtensions.filter((extension) => extension.sourceInfo.scope === "user"),
    [filteredExtensions],
  );
  const projectExtensions = useMemo(
    () => filteredExtensions.filter((extension) => extension.sourceInfo.scope !== "user"),
    [filteredExtensions],
  );
  const selectedExtension =
    filteredExtensions.find((extension) => extension.path === selectedExtensionPath) ?? filteredExtensions[0];
  const selectedCompatibilityRecords = useMemo(
    () =>
      selectedExtension
        ? commandCompatibility
            .filter((record) => record.extensionPath === selectedExtension.path)
            .sort((left, right) => left.commandName.localeCompare(right.commandName))
        : [],
    [commandCompatibility, selectedExtension],
  );

  // Load extension config when selected extension changes
  useEffect(() => {
    if (!selectedExtension?.path || !onGetExtensionConfig) {
      setExtensionConfig(null);
      setConfigDraft({});
      return;
    }
    onGetExtensionConfig(selectedExtension.path).then((config) => {
      setExtensionConfig(config);
      if (config) {
        const draft: Record<string, string | number | boolean> = {};
        for (const field of config.fields) {
          if (field.currentValue !== undefined) {
            draft[field.key] = field.currentValue;
          } else if (field.defaultValue !== undefined) {
            draft[field.key] = field.defaultValue;
          }
        }
        setConfigDraft(draft);
      } else {
        setConfigDraft({});
      }
    }).catch(() => {
      setExtensionConfig(null);
      setConfigDraft({});
    });
  }, [selectedExtension?.path, onGetExtensionConfig]);

  const handleAnalyzeConfig = useCallback(async () => {
    if (!selectedExtension?.path || !onAnalyzeExtensionConfig) return;
    setIsAnalyzing(true);
    try {
      const config = await onAnalyzeExtensionConfig(selectedExtension.path, analysisModel);
      setExtensionConfig(config);
      const draft: Record<string, string | number | boolean> = {};
      for (const field of config.fields) {
        if (field.currentValue !== undefined) {
          draft[field.key] = field.currentValue;
        } else if (field.defaultValue !== undefined) {
          draft[field.key] = field.defaultValue;
        }
      }
      setConfigDraft(draft);
    } catch (err) {
      console.error("Failed to analyze extension config:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedExtension?.path, onAnalyzeExtensionConfig, analysisModel]);

  const handleSaveConfig = useCallback(async () => {
    if (!selectedExtension?.path || !onSetExtensionConfig || !extensionConfig) return;
    const values: ExtensionConfigValue[] = Object.entries(configDraft).map(([key, value]) => ({
      key,
      value,
    }));
    await onSetExtensionConfig(selectedExtension.path, values);
  }, [selectedExtension?.path, onSetExtensionConfig, extensionConfig, configDraft]);

  const handleInstall = useCallback(async () => {
    if (!installSource.trim() || !onInstallExtension) return;
    setIsInstalling(true);
    setInstallResult(null);
    try {
      const result = await onInstallExtension(installSource.trim(), installLocal);
      setInstallResult(result);
      if (result.success) {
        // Refresh the extension list
        onRefresh();
        // If auto-analyze is enabled, analyze the newly installed extension
        if (autoAnalyze && onAnalyzeExtensionConfig) {
          // Wait a bit for the runtime to refresh, then find and analyze the new extension
          setTimeout(() => {
            // Extract package name from source (e.g., npm:pi-smart-compact -> pi-smart-compact)
            const packageName = installSource.replace(/^(npm:|git:)/, "").split("/").pop() ?? "";
            // Find the extension that matches the package name
            const newExt = runtime?.extensions.find((e) => {
              const extName = e.displayName.toLowerCase();
              const pathLower = e.path.toLowerCase();
              return extName.includes(packageName.toLowerCase()) || pathLower.includes(packageName.toLowerCase());
            });
            if (newExt?.path) {
              void onAnalyzeExtensionConfig(newExt.path, analysisModel);
            }
          }, 3000);
        }
        setInstallSource("");
      }
    } catch (err) {
      setInstallResult({ success: false, message: String(err) });
    } finally {
      setIsInstalling(false);
    }
  }, [installSource, installLocal, autoAnalyze, analysisModel, onInstallExtension, onAnalyzeExtensionConfig, onRefresh, runtime?.extensions]);

  if (!workspace) {
    return (
      <div className="empty-panel">
        <div className="session-header__eyebrow">Extensions</div>
        <h1>Select a workspace</h1>
        <p>Extensions are discovered from the selected workspace plus your user-level extension directories.</p>
      </div>
    );
  }

  return (
    <div className="skills-content skills-view">
      <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">Extensions</div>
            <h1 className="view-header__title">Extensions</h1>
            <p className="view-header__body">
              Manage runtime extensions. Global extensions are enabled for every workspace; project extensions belong to the selected workspace.
            </p>
          </div>
          <div className="view-header__actions">
            <button className="button button--secondary" type="button" onClick={() => { playButtonClick(); onRefresh(); }}>
              <RefreshIcon />
              <span>Refresh</span>
            </button>
          </div>
      </header>

      {/* Install section */}
      {onInstallExtension ? (
        <section className="extension-install-section">
          <h3 className="mt-0 mb-3 text-sm font-semibold text-foreground">Install extension</h3>
          <div className="flex items-center gap-2">
            <input
              className="settings-text-input"
              type="text"
              placeholder="npm:package-name or git:github.com/user/repo"
              value={installSource}
              onChange={(e) => {
                setInstallSource(e.target.value);
                setInstallResult(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && installSource.trim()) {
                  void handleInstall();
                }
              }}
              disabled={isInstalling}
              style={{ flex: 1 }}
            />
            <button
              className="button button--secondary"
              type="button"
              disabled={isInstalling || !installSource.trim()}
              onClick={() => void handleInstall()}
            >
              {isInstalling ? "Installing..." : "Install"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <input
                type="checkbox"
                checked={installLocal}
                onChange={(e) => setInstallLocal(e.target.checked)}
              />
              Project-local
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <input
                type="checkbox"
                checked={autoAnalyze}
                onChange={(e) => setAutoAnalyze(e.target.checked)}
              />
              Auto-analyze after install
            </label>
            {availableModels.length > 0 ? (
              <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                Analysis model:
                <select
                  className="settings-text-input"
                  style={{ padding: "2px 4px", fontSize: "12px", minWidth: "150px" }}
                  value={analysisModel}
                  onChange={(e) => setAnalysisModel(e.target.value)}
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {installResult ? (
            <div style={{
              marginTop: "8px",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px",
              background: installResult.success ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              color: installResult.success ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)",
            }}>
              {installResult.message}
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-muted-foreground/70">
            Examples: <code>npm:pi-smart-compact</code> · <code>git:github.com/user/repo</code> · <code>./local/path</code>
          </div>
        </section>
      ) : null}

      <div className="skills-main-grid">
        <section className="skills-main-list" aria-label="Extensions list">
          <div className="skills-rail">
            <div className="skills-rail__search">
              <input
                aria-label="Search extensions"
                className="skills-rail__search-input"
                placeholder="Search extensions, commands, or tools…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <div className="skills-rail__list" data-testid="extensions-list">
              {filteredExtensions.length === 0 ? (
                <ExtensionsEmptyState message="Refresh runtime discovery to load global and project extensions." />
              ) : (
                <>
                  {globalExtensions.length > 0 ? (
                    <ExtensionGroup
                      label="Global"
                      extensions={globalExtensions}
                      selectedPath={selectedExtension?.path}
                      onSelect={setSelectedExtensionPath}
                    />
                  ) : null}
                  {projectExtensions.length > 0 ? (
                    <ExtensionGroup
                      label={`Project${workspace.name ? ` · ${workspace.name}` : ""}`}
                      extensions={projectExtensions}
                      selectedPath={selectedExtension?.path}
                      onSelect={setSelectedExtensionPath}
                    />
                  ) : null}
                </>
              )}
            </div>
            <footer className="skills-rail__footer">
              <span>{extensions.length} extensions</span>
            </footer>
          </div>
        </section>

        <div className="skill-detail">
            {selectedExtension ? (
              <>
                <header className="skill-detail__header">
                  <div className="skill-detail__identity">
                    <span className="skill-detail__avatar">
                      <ExtensionIcon />
                    </span>
                    <div className="skill-detail__heading">
                      <div className="skill-detail__title-row">
                        <h2>{selectedExtension.displayName}</h2>
                        <span
                          className={`skill-status skill-detail__status ${
                            selectedExtension.enabled
                              ? "skill-status--enabled skill-detail__status--enabled"
                              : "skill-status--disabled"
                          }`}
                        >
                          <span className="skill-status__dot" />
                          {extensionStatusLabel(selectedExtension)}
                        </span>
                      </div>
                      <div className="skill-detail__tags">
                        <span className="skill-tag">{selectedExtension.sourceInfo.source}</span>
                        <span className="skill-tag skill-tag--muted">{selectedExtension.sourceInfo.scope}</span>
                      </div>
                      {selectedExtension.sourceInfo.scope === "user" ? (
                        <p className="skill-detail__description">
                          Enabling or disabling this extension applies globally, across every workspace.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </header>
                <div className="skill-detail__grid">
                  <div className="skill-detail__panel skill-detail__panel--details">
                    <h3 className="skill-detail__panel-title">Details</h3>
                    <div className="skill-detail__meta-list">
                  <DetailItem label="Scope" value={selectedExtension.sourceInfo.scope} />
                  <DetailItem label="Origin" value={selectedExtension.sourceInfo.origin} />
                  <DetailItem label="Path" value={selectedExtension.path} mono />
                  {selectedExtension.sourceInfo.baseDir ? (
                    <DetailItem label="Base dir" value={selectedExtension.sourceInfo.baseDir} mono />
                  ) : null}
                    </div>
                  </div>
                  <div className="skill-detail__panel skill-detail__panel--actions">
                    <h3 className="skill-detail__panel-title">Actions</h3>
                    <div className="skill-detail__action-stack">
                      <button className="button button--secondary" type="button" onClick={() => { playButtonClick(); onOpenExtensionFolder(selectedExtension.path); }}>
                        <FolderIcon />
                        <span>Open folder</span>
                      </button>
                      <button
                        className={`button button--secondary ${selectedExtension.enabled ? "skill-detail__danger" : ""}`}
                        type="button"
                        onClick={() => { playButtonClick(); onToggleExtension(selectedExtension.path, !selectedExtension.enabled); }}
                      >
                        {selectedExtension.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="button button--secondary skill-detail__danger"
                        type="button"
                        onClick={() => { playButtonSecondary(); onDeleteExtension(selectedExtension.path); }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                <ExtensionContributionSection title="Commands" items={selectedExtension.commands} emptyLabel="No commands contributed." />
                <ExtensionCompatibilitySection
                  commands={selectedExtension.commands}
                  compatibilityRecords={selectedCompatibilityRecords}
                />
                <ExtensionContributionSection title="Tools" items={selectedExtension.tools} emptyLabel="No tools contributed." />
                <ExtensionContributionSection title="Flags" items={selectedExtension.flags} emptyLabel="No flags contributed." />
                <ExtensionContributionSection title="Shortcuts" items={selectedExtension.shortcuts} emptyLabel="No shortcuts contributed." />
                <ExtensionDiagnostics diagnostics={selectedExtension.diagnostics} />
                <ExtensionConfigSection
                  config={extensionConfig}
                  isAnalyzing={isAnalyzing}
                  configDraft={configDraft}
                  onAnalyze={handleAnalyzeConfig}
                  onSave={handleSaveConfig}
                  onChangeField={(key, value) => setConfigDraft((prev) => ({ ...prev, [key]: value }))}
                  hasAnalyzer={Boolean(onAnalyzeExtensionConfig)}
                  analysisModel={analysisModel}
                  availableModels={availableModels}
                  onModelChange={setAnalysisModel}
                />
              </>
            ) : (
              <ExtensionsEmptyState message="Refresh runtime discovery to inspect extension metadata and diagnostics." />
            )}
          </div>
      </div>
    </div>
  );
}

function extensionStatusLabel(extension: RuntimeExtensionRecord): string {
  if (extension.sourceInfo.scope === "user") {
    return extension.enabled ? "Enabled globally" : "Disabled globally";
  }
  return extension.enabled ? "Enabled" : "Disabled";
}

function ExtensionGroup({
  label,
  extensions,
  selectedPath,
  onSelect,
}: {
  readonly label: string;
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
}) {
  return (
    <div className="skills-rail__group">
      <div className="skills-rail__group-label">{label}</div>
      {extensions.map((extension) => (
        <button
          className={`skill-row ${selectedPath === extension.path ? "skill-row--active" : ""}`}
          key={extension.path}
          type="button"
          onClick={() => {
            onSelect(extension.path);
          }}
        >
          <span className="skill-row__avatar">
            <ExtensionIcon />
          </span>
          <span className="skill-row__body">
            <span className="skill-row__title">{extension.displayName}</span>
            <span className="skill-row__description">
              {extension.sourceInfo.scope} · {extension.sourceInfo.origin}
            </span>
          </span>
          <span className={`skill-status ${extension.enabled ? "skill-status--enabled" : "skill-status--disabled"}`}>
            <span className="skill-status__dot" />
            {extensionStatusLabel(extension)}
          </span>
        </button>
      ))}
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <div className="skill-detail__meta-label">{label}</div>
      <div className={mono ? "skill-detail__path" : "skill-detail__description"}>{value}</div>
    </div>
  );
}

function ExtensionContributionSection({
  title,
  items,
  emptyLabel,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly emptyLabel: string;
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">{title}</div>
        {items.length > 0 ? (
          <div className="extension-detail__tokens">
            {items.map((item) => (
              <span className="slash-menu__skill-badge" key={item}>
                {item}
              </span>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">Diagnostics</div>
        {diagnostics.length > 0 ? (
          <div className="extension-detail__diagnostics">
            {diagnostics.map((diagnostic, index) => (
              <div className={`activity-item activity-item--${diagnostic.type === "error" ? "error" : "info"}`} key={`${diagnostic.message}:${index}`}>
                <div className="activity-item__text">{diagnostic.message}</div>
                {diagnostic.path ? <div className="activity-item__meta">{diagnostic.path}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="skill-detail__description">No diagnostics reported.</div>
        )}
      </div>
    </div>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) => record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">Command compatibility</div>
        <div className="skill-detail__description">
          Learned from real GUI execution. Unlisted commands remain unknown until exercised.
        </div>
        <div className="extension-detail__tokens">
          {supported.map((record) => (
            <span className="slash-menu__skill-badge" key={`supported:${record.commandName}`}>
              {record.commandName} · GUI-compatible
            </span>
          ))}
          {terminalOnly.map((record) => (
            <span className="slash-menu__skill-badge slash-menu__skill-badge--warning" key={`terminal:${record.commandName}`}>
              {record.commandName} · Terminal-only
            </span>
          ))}
          {unknown.map((commandName) => (
            <span className="slash-menu__skill-badge" key={`unknown:${commandName}`}>
              {commandName} · Unknown
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExtensionsEmptyState({ message }: { readonly message: string }) {
  return (
    <div className="empty-state">
      <h2>No extensions found</h2>
      <p>{message}</p>
    </div>
  );
}

function ExtensionConfigSection({
  config,
  isAnalyzing,
  configDraft,
  onAnalyze,
  onSave,
  onChangeField,
  hasAnalyzer,
  analysisModel,
  availableModels,
  onModelChange,
}: {
  readonly config: ExtensionConfigSchema | null;
  readonly isAnalyzing: boolean;
  readonly configDraft: Record<string, string | number | boolean>;
  readonly onAnalyze: () => Promise<void>;
  readonly onSave: () => Promise<void>;
  readonly onChangeField: (key: string, value: string | number | boolean) => void;
  readonly hasAnalyzer: boolean;
  readonly analysisModel?: string;
  readonly availableModels?: readonly string[];
  readonly onModelChange?: (model: string) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="skill-detail__meta-list">
      <div>
        <div className="skill-detail__meta-label">
          Configuration
          {config ? (
            <span className="skill-tag skill-tag--muted" style={{ marginLeft: "8px" }}>
              {config.fields.length} fields
            </span>
          ) : null}
        </div>
        {availableModels && availableModels.length > 0 && onModelChange ? (
          <div style={{ margin: "8px 0", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <span style={{ color: "var(--text-secondary)" }}>Analysis model:</span>
            <select
              className="settings-text-input"
              style={{ padding: "2px 4px", fontSize: "12px", minWidth: "150px" }}
              value={analysisModel ?? ""}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {config ? (
          <>
            <div className="skill-detail__description">
              Discovered configuration options. Edit values below to configure this extension.
            </div>
            <div className="extension-config-fields" style={{ marginTop: "12px" }}>
              {config.fields.map((field) => (
                <ExtensionConfigFieldRow
                  key={field.key}
                  field={field}
                  value={configDraft[field.key]}
                  onChange={(value) => onChangeField(field.key, value)}
                />
              ))}
            </div>
            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
              <button
                className="button button--secondary"
                type="button"
                disabled={isSaving}
                onClick={handleSave}
              >
                {isSaving ? "Saving..." : "Save configuration"}
              </button>
              {hasAnalyzer ? (
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={isAnalyzing}
                  onClick={onAnalyze}
                >
                  {isAnalyzing ? "Analyzing..." : "Re-analyze"}
                </button>
              ) : null}
            </div>
            {config.analyzedAt ? (
              <div className="skill-detail__description" style={{ marginTop: "8px" }}>
                Last analyzed: {new Date(config.analyzedAt).toLocaleString()}
                {config.analyzedBy ? ` by ${config.analyzedBy}` : ""}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="skill-detail__description">
              No configuration discovered yet. Click analyze to scan for configurable options.
            </div>
            {hasAnalyzer ? (
              <button
                className="button button--secondary"
                type="button"
                disabled={isAnalyzing}
                onClick={onAnalyze}
                style={{ marginTop: "8px" }}
              >
                {isAnalyzing ? "Analyzing..." : "Analyze configuration"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ExtensionConfigFieldRow({
  field,
  value,
  onChange,
}: {
  readonly field: ExtensionConfigField;
  readonly value: string | number | boolean | undefined;
  readonly onChange: (value: string | number | boolean) => void;
}) {
  const sourceLabel = field.source === "env" ? "ENV" : field.source === "file" ? "FILE" : field.source === "flag" ? "FLAG" : "CONST";

  return (
    <div className="extension-config-field" style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span className="skill-detail__meta-label" style={{ margin: 0 }}>{field.label}</span>
        <span className="slash-menu__skill-badge" style={{ fontSize: "10px" }}>{sourceLabel}</span>
      </div>
      {field.description ? (
        <div className="skill-detail__description" style={{ marginBottom: "4px" }}>{field.description}</div>
      ) : null}
      {field.sourcePath ? (
        <div className="skill-detail__path" style={{ marginBottom: "4px" }}>{field.sourcePath}</div>
      ) : null}
      {field.type === "boolean" ? (
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={value !== undefined ? Boolean(value) : Boolean(field.defaultValue)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="skill-detail__description">{String(value ?? field.defaultValue ?? false)}</span>
        </label>
      ) : field.type === "select" && field.options ? (
        <select
          className="settings-text-input"
          value={String(value ?? field.defaultValue ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          className="settings-text-input settings-text-input--small"
          type="number"
          value={value !== undefined ? Number(value) : field.defaultValue !== undefined ? Number(field.defaultValue) : ""}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : (
        <input
          className="settings-text-input"
          type="text"
          value={String(value ?? field.defaultValue ?? "")}
          placeholder={field.key}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
