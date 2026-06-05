import { useState } from "react";
import type {
  ContextSection,
  ContextSnapshot,
  WorkspaceRecord,
} from "./desktop-state";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderIcon,
  RefreshIcon,
} from "./icons";
import type { PiDesktopApi } from "./ipc";
import { playButtonClick } from "./button-click-sound";

interface ContextViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly snapshot: ContextSnapshot | null;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onOpenFile?: (filePath: string) => void;
  readonly api: PiDesktopApi;
}

export function ContextView({
  workspace,
  runtime: _runtime,
  snapshot,
  loading,
  onRefresh,
  onOpenFile,
  api,
}: ContextViewProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["context-file", "skill", "extension"]));

  const toggleSection = (kind: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  const copyAll = async () => {
    if (!snapshot) return;
    const text = formatSnapshotAsText(snapshot);
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  if (!workspace) {
    return (
      <div className="empty-panel">
        <div className="session-header__eyebrow">Context</div>
        <h1>Select a workspace</h1>
        <p>Context shows the effective prompt chain for the selected workspace and session.</p>
      </div>
    );
  }

  const sections = snapshot?.sections ?? [];
  const grouped = groupSections(sections);

  return (
    <div className="context-view">
      <header className="view-header">
        <div>
          <div className="chat-header__eyebrow">Context</div>
          <h1 className="view-header__title">Context</h1>
          <p className="view-header__body">
            The effective prompt chain for <strong>{workspace.name}</strong>
            {snapshot?.sessionId ? " and the selected session" : ""}.
          </p>
        </div>
        <div className="view-header__actions">
          <button className="button button--secondary" type="button" onClick={() => { playButtonClick(); onRefresh(); }}>
            <RefreshIcon />
            <span>Refresh</span>
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => { playButtonClick(); copyAll(); }}
            disabled={!snapshot}
          >
            <CopyIcon />
            <span>{copiedAll ? "Copied!" : "Copy all"}</span>
          </button>
        </div>
      </header>

      {loading && !snapshot ? (
        <div className="context-loading">
          <p>Loading context snapshot…</p>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state">
          <h2>No context available</h2>
          <p>Refresh runtime discovery to load workspace context files and settings.</p>
        </div>
      ) : (
        <div className="context-sections">
          {grouped.map((group) => {
            const isExpanded = expandedSections.has(group.kind);
            return (
              <div className="context-group" key={group.kind}>
                <button
                  className="context-group__header"
                  type="button"
                  onClick={() => { playButtonClick(); toggleSection(group.kind); }}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <span className="context-group__label">{group.label}</span>
                  <span className="context-group__count">{group.sections.length}</span>
                </button>
                {isExpanded ? (
                  <div className="context-group__items">
                    {group.sections.map((section, index) => (
                      <ContextSectionRow
                        key={`${section.kind}-${section.label}-${index}`}
                        section={section}
                        onOpenFile={onOpenFile}
                        api={api}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Section row ────────────────────────────────────────── */

interface ContextSectionRowProps {
  readonly section: ContextSection;
  readonly onOpenFile?: (filePath: string) => void;
  readonly api: PiDesktopApi;
}

function ContextSectionRow({ section, onOpenFile, api: _api }: ContextSectionRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`context-row ${expanded ? "context-row--expanded" : ""}`}>
      <div className="context-row__header" onClick={() => { playButtonClick(); setExpanded(!expanded); }}>
        <span className="context-row__label">{section.label}</span>
        <span className="context-row__meta">
          {section.origin ? <span className="context-tag">{section.origin}</span> : null}
          {section.scope ? <span className="context-tag context-tag--muted">{section.scope}</span> : null}
          {section.enabled === false ? (
            <span className="context-tag context-tag--disabled">disabled</span>
          ) : null}
        </span>
      </div>
      {section.path ? (
        <div className="context-row__actions">
          {onOpenFile ? (
            <button
              className="icon-button"
              type="button"
              title="Open in Finder"
              onClick={(e) => {
                e.stopPropagation();
                playButtonClick();
                onOpenFile(section.path!);
              }}
            >
              <FolderIcon />
            </button>
          ) : null}
        </div>
      ) : null}
      {expanded && section.content ? (
        <pre className="context-row__content">{section.content}</pre>
      ) : null}
      {expanded && section.detail && !section.content ? (
        <p className="context-row__detail">{section.detail}</p>
      ) : null}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────── */

interface SectionGroup {
  readonly kind: string;
  readonly label: string;
  readonly sections: readonly ContextSection[];
}

const SECTION_ORDER: readonly string[] = [
  "system-prompt",
  "context-file",
  "skill",
  "extension",
  "command",
  "model-settings",
  "user-message",
];

const SECTION_LABELS: Readonly<Record<string, string>> = {
  "system-prompt": "System prompt",
  "context-file": "Context files",
  skill: "Skills",
  extension: "Extensions & tools",
  command: "Commands / prompts",
  "model-settings": "Model & runtime settings",
  "user-message": "User message",
};

function groupSections(sections: readonly ContextSection[]): readonly SectionGroup[] {
  const buckets = new Map<string, ContextSection[]>();
  for (const section of sections) {
    const existing = buckets.get(section.kind);
    if (existing) {
      existing.push(section);
    } else {
      buckets.set(section.kind, [section]);
    }
  }
  return SECTION_ORDER
    .filter((kind) => buckets.has(kind))
    .map((kind) => ({
      kind,
      label: SECTION_LABELS[kind] ?? kind,
      sections: buckets.get(kind)!,
    }));
}

function formatSnapshotAsText(snapshot: ContextSnapshot): string {
  const lines: string[] = [];
  lines.push(`# Context: ${snapshot.workspaceId}`);
  if (snapshot.sessionId) lines.push(`Session: ${snapshot.sessionId}`);
  lines.push("");
  const grouped = groupSections(snapshot.sections);
  for (const group of grouped) {
    lines.push(`## ${group.label}`);
    for (const section of group.sections) {
      const meta = [section.origin, section.scope].filter(Boolean).join(" / ");
      lines.push(`### ${section.label}${meta ? ` (${meta})` : ""}`);
      if (section.content) lines.push(section.content);
      if (section.detail && !section.content) lines.push(section.detail);
      lines.push("");
    }
  }
  return lines.join("\n");
}
