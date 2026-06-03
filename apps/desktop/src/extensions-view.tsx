import { useMemo, useState } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord, WorkspaceRecord } from "./desktop-state";
import { ExtensionIcon, FolderIcon, RefreshIcon } from "./icons";

interface ExtensionsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly commandCompatibility?: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onOpenExtensionFolder: (filePath: string) => void;
  readonly onToggleExtension: (filePath: string, enabled: boolean) => void;
  readonly onDeleteExtension: (filePath: string) => void;
}

export function ExtensionsView({
  workspace,
  runtime,
  commandCompatibility = [],
  onRefresh,
  onOpenExtensionFolder,
  onToggleExtension,
  onDeleteExtension,
}: ExtensionsViewProps) {
  const [query, setQuery] = useState("");
  const [selectedExtensionPath, setSelectedExtensionPath] = useState<string | undefined>();
  const extensions = runtime?.extensions ?? [];
  const filteredExtensions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return extensions;
    }

    return extensions.filter((extension) =>
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
  }, [extensions, query]);
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
              Inspect and manage first-class runtime extensions for this workspace.
            </p>
          </div>
          <div className="view-header__actions">
            <button className="button button--secondary" type="button" onClick={onRefresh}>
              <RefreshIcon />
              <span>Refresh</span>
            </button>
          </div>
      </header>

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
                <ExtensionsEmptyState message="Refresh runtime discovery to load workspace and user-level extensions." />
              ) : (
                filteredExtensions.map((extension) => (
                  <button
                    className={`skill-row ${selectedExtension?.path === extension.path ? "skill-row--active" : ""}`}
                    key={extension.path}
                    type="button"
                    onClick={() => {
                      setSelectedExtensionPath(extension.path);
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
                      {extension.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </button>
                ))
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
                        <span className={`skill-status ${selectedExtension.enabled ? "skill-status--enabled" : "skill-status--disabled"}`}>
                          <span className="skill-status__dot" />
                          {selectedExtension.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="skill-detail__tags">
                        <span className="skill-tag">{selectedExtension.sourceInfo.source}</span>
                        <span className="skill-tag skill-tag--muted">{selectedExtension.sourceInfo.scope}</span>
                      </div>
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
                      <button className="button button--secondary" type="button" onClick={() => onOpenExtensionFolder(selectedExtension.path)}>
                        <FolderIcon />
                        <span>Open folder</span>
                      </button>
                      <button
                        className={`button button--secondary ${selectedExtension.enabled ? "skill-detail__danger" : ""}`}
                        type="button"
                        onClick={() => onToggleExtension(selectedExtension.path, !selectedExtension.enabled)}
                      >
                        {selectedExtension.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="button button--secondary skill-detail__danger"
                        type="button"
                        onClick={() => onDeleteExtension(selectedExtension.path)}
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
              </>
            ) : (
              <ExtensionsEmptyState message="Refresh runtime discovery to inspect extension metadata and diagnostics." />
            )}
          </div>
      </div>
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
