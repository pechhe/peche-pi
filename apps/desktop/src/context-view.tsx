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
  const tokenAnalysis = analyzeTokens(sections);

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

      {/* Token Analysis Summary */}
      {sections.length > 0 ? (
        <div className="context-analysis">
          <h2 className="context-analysis__title">Token Analysis</h2>
          <div className="context-analysis__summary">
            <div className="context-analysis__stat">
              <span className="context-analysis__stat-label">Total estimated tokens</span>
              <span className="context-analysis__stat-value">{tokenAnalysis.totalTokens.toLocaleString()}</span>
            </div>
            <div className="context-analysis__stat">
              <span className="context-analysis__stat-label">Context window usage</span>
              <span className="context-analysis__stat-value">{tokenAnalysis.percentage}%</span>
            </div>
            <div className="context-analysis__stat">
              <span className="context-analysis__stat-label">Sections</span>
              <span className="context-analysis__stat-value">{sections.length}</span>
            </div>
          </div>

          {/* Token breakdown by section */}
          <div className="context-analysis__breakdown">
            <h3 className="context-analysis__subtitle">Breakdown by section</h3>
            {tokenAnalysis.sectionBreakdown.map((item) => (
              <div key={item.kind} className="context-analysis__bar-row">
                <div className="context-analysis__bar-label">
                  <span>{item.label}</span>
                  <span className="context-analysis__bar-tokens">{item.tokens.toLocaleString()} tokens</span>
                </div>
                <div className="context-analysis__bar-track">
                  <div
                    className={`context-analysis__bar-fill context-analysis__bar-fill--${item.severity}`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <span className="context-analysis__bar-percentage">{item.percentage}%</span>
              </div>
            ))}
          </div>

          {/* Bloat analysis */}
          {tokenAnalysis.warnings.length > 0 ? (
            <div className="context-analysis__warnings">
              <h3 className="context-analysis__subtitle">⚠️ Potential issues</h3>
              <ul className="context-analysis__warning-list">
                {tokenAnalysis.warnings.map((warning, i) => (
                  <li key={i} className="context-analysis__warning-item">{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Recommendations */}
          {tokenAnalysis.recommendations.length > 0 ? (
            <div className="context-analysis__recommendations">
              <h3 className="context-analysis__subtitle">💡 Recommendations</h3>
              <ul className="context-analysis__recommendation-list">
                {tokenAnalysis.recommendations.map((rec, i) => (
                  <li key={i} className="context-analysis__recommendation-item">{rec}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

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
            const groupTokens = group.sections.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);
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
                  <span className="context-group__tokens">{groupTokens.toLocaleString()} tokens</span>
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
          {section.tokenCount !== undefined ? (
            <span className="context-tag context-tag--tokens">{section.tokenCount.toLocaleString()} tokens</span>
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

/* ── Token Analysis ────────────────────────────────────── */

interface TokenAnalysis {
  readonly totalTokens: number;
  readonly percentage: number;
  readonly sectionBreakdown: readonly {
    readonly kind: string;
    readonly label: string;
    readonly tokens: number;
    readonly percentage: number;
    readonly severity: "low" | "medium" | "high";
  }[];
  readonly warnings: readonly string[];
  readonly recommendations: readonly string[];
}

/** Assume 200k context window for modern models */
const ASSUMED_CONTEXT_WINDOW = 200_000;

function analyzeTokens(sections: readonly ContextSection[]): TokenAnalysis {
  const totalTokens = sections.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);
  const percentage = Math.round((totalTokens / ASSUMED_CONTEXT_WINDOW) * 100);

  // Group by kind
  const byKind = new Map<string, number>();
  for (const section of sections) {
    const current = byKind.get(section.kind) ?? 0;
    byKind.set(section.kind, current + (section.tokenCount ?? 0));
  }

  const sectionBreakdown = SECTION_ORDER
    .filter((kind) => byKind.has(kind))
    .map((kind) => {
      const tokens = byKind.get(kind)!;
      const pct = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;
      const severity: "low" | "medium" | "high" = pct > 50 ? "high" : pct > 25 ? "medium" : "low";
      return {
        kind,
        label: SECTION_LABELS[kind] ?? kind,
        tokens,
        percentage: pct,
        severity,
      };
    });

  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Check for bloat
  if (percentage > 50) {
    warnings.push(`Context is using ${percentage}% of the estimated 200k context window. This is getting heavy.`);
  }

  // Check for large context files
  const contextFileTokens = byKind.get("context-file") ?? 0;
  if (contextFileTokens > 20_000) {
    warnings.push(`Context files (AGENTS.md, CLAUDE.md) total ${contextFileTokens.toLocaleString()} tokens. Consider trimming.`);
    recommendations.push("Review AGENTS.md for outdated or redundant instructions.");
  }

  // Check for too many skills
  const skillCount = sections.filter((s) => s.kind === "skill").length;
  if (skillCount > 20) {
    warnings.push(`${skillCount} skills registered. Each adds description tokens to the system prompt.`);
    recommendations.push("Disable unused skills or consolidate related ones.");
  }

  // Check system prompt size
  const systemPromptTokens = byKind.get("system-prompt") ?? 0;
  if (systemPromptTokens > 10_000) {
    warnings.push(`System prompt is ${systemPromptTokens.toLocaleString()} tokens. This includes base instructions + appended content.`);
  }

  // General recommendations
  if (totalTokens > 30_000) {
    recommendations.push("Use /compact to summarize older conversation history when context gets large.");
  }
  if (percentage > 30) {
    recommendations.push("Consider using a model with a larger context window if you need more room.");
  }

  return {
    totalTokens,
    percentage,
    sectionBreakdown,
    warnings,
    recommendations,
  };
}
