import { useMemo } from "react";
import type { RuntimeSkillRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, PlusIcon, RefreshIcon, SkillIcon } from "./icons";
import { titleCase } from "./string-utils";
import { playButtonClick } from "./button-click-sound";

interface SkillGroup {
  readonly key: string;
  readonly label: string;
  readonly skills: readonly RuntimeSkillRecord[];
}

function filterSkills(
  skills: readonly RuntimeSkillRecord[],
  query: string,
  showDisabled: boolean,
): readonly RuntimeSkillRecord[] {
  const normalized = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (!showDisabled && !skill.enabled) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return [skill.name, skill.description, skill.source, skill.slashCommand].some((value) =>
      value.toLowerCase().includes(normalized),
    );
  });
}

function groupSkills(skills: readonly RuntimeSkillRecord[]): readonly SkillGroup[] {
  const buckets = new Map<string, RuntimeSkillRecord[]>();
  for (const skill of skills) {
    const key = skill.source || "other";
    const existing = buckets.get(key);
    if (existing) {
      existing.push(skill);
    } else {
      buckets.set(key, [skill]);
    }
  }
  return Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      label: titleCase(key),
      skills: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ──────────────────────────────────────────────────────────────
 * Sidebar (renders inside SecondarySurface's left rail)
 * ────────────────────────────────────────────────────────────── */

interface SkillsSidebarProps {
  readonly runtime?: RuntimeSnapshot;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly showDisabled: boolean;
  readonly onShowDisabledChange: (value: boolean) => void;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly onToggleGroup: (key: string) => void;
  readonly selectedSkillPath: string | undefined;
  readonly onSelectSkill: (filePath: string) => void;
}

function SkillsSidebar({
  runtime,
  query,
  onQueryChange,
  showDisabled,
  onShowDisabledChange,
  collapsedGroups,
  onToggleGroup,
  selectedSkillPath,
  onSelectSkill,
}: SkillsSidebarProps) {
  const allSkills = runtime?.skills ?? [];
  const filtered = useMemo(
    () => filterSkills(allSkills, query, showDisabled),
    [allSkills, query, showDisabled],
  );
  const groups = useMemo(() => groupSkills(filtered), [filtered]);
  const enabledCount = allSkills.filter((skill) => skill.enabled).length;

  return (
    <div className="skills-rail">
      <div className="skills-rail__search">
        <input
          aria-label="Search skills"
          className="skills-rail__search-input"
          placeholder="Search skills, sources, or descriptions…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <label className="skills-rail__toggle">
        <input
          type="checkbox"
          checked={showDisabled}
          onChange={(event) => onShowDisabledChange(event.target.checked)}
        />
        <span>Show disabled</span>
      </label>

      <div className="skills-rail__list" data-testid="skills-list">
        {groups.length === 0 ? (
          <div className="skills-rail__empty">No skills match your search.</div>
        ) : (
          groups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <div className="skills-group" key={group.key}>
                <button
                  type="button"
                  className="skills-group__header"
                  onClick={() => { playButtonClick(); onToggleGroup(group.key); }}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  <span className="skills-group__label">{group.label}</span>
                  <span className="skills-group__count">({group.skills.length})</span>
                </button>
                {collapsed ? null : (
                  <div className="skills-group__items">
                    {group.skills.map((skill) => (
                      <button
                        key={skill.filePath}
                        type="button"
                        className={`skill-row ${
                          selectedSkillPath === skill.filePath ? "skill-row--active" : ""
                        }`}
                        onClick={() => { playButtonClick(); onSelectSkill(skill.filePath); }}
                      >
                        <span className="skill-row__avatar">
                          <SkillIcon />
                        </span>
                        <span className="skill-row__body">
                          <span className="skill-row__title">{titleCase(skill.name)}</span>
                          <span className="skill-row__description">{skill.description}</span>
                        </span>
                        <span
                          className={`skill-status ${
                            skill.enabled ? "skill-status--enabled" : "skill-status--disabled"
                          }`}
                        >
                          <span className="skill-status__dot" />
                          {skill.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <footer className="skills-rail__footer">
        <span>
          {allSkills.length} skill{allSkills.length === 1 ? "" : "s"}
        </span>
        <span className="skills-rail__footer-dot">•</span>
        <span>{enabledCount} enabled</span>
      </footer>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Main content (header + detail panel)
 * ────────────────────────────────────────────────────────────── */

interface SkillsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly showDisabled: boolean;
  readonly onShowDisabledChange: (value: boolean) => void;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly onToggleGroup: (key: string) => void;
  readonly selectedSkillPath: string | undefined;
  readonly onSelectSkill: (filePath: string) => void;
  readonly onRefresh: () => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly onTrySkill: (skill: RuntimeSkillRecord) => void;
}

export function SkillsView({
  workspace,
  runtime,
  query,
  onQueryChange,
  showDisabled,
  onShowDisabledChange,
  collapsedGroups,
  onToggleGroup,
  selectedSkillPath,
  onSelectSkill,
  onRefresh,
  onOpenSkillFolder,
  onToggleSkill,
  onTrySkill,
}: SkillsViewProps) {
  const allSkills = runtime?.skills ?? [];
  const filtered = useMemo(
    () => filterSkills(allSkills, query, showDisabled),
    [allSkills, query, showDisabled],
  );
  const selectedSkill =
    filtered.find((skill) => skill.filePath === selectedSkillPath) ?? filtered[0];

  if (!workspace) {
    return (
      <div className="empty-panel">
        <div className="session-header__eyebrow">Skills</div>
        <h1>Select a workspace</h1>
        <p>Skills are discovered from the selected workspace plus your user-level skill directories.</p>
      </div>
    );
  }

  return (
    <div className="skills-content skills-view">
      <header className="view-header">
        <div>
          <div className="chat-header__eyebrow">Skills</div>
          <h1 className="view-header__title">Skills</h1>
          <p className="view-header__body">
            Give pi workspace-specific capabilities and reusable workflows.
          </p>
        </div>
        <div className="view-header__actions">
          <button className="button button--secondary" type="button" onClick={() => { playButtonClick(); onRefresh(); }}>
            <RefreshIcon />
            <span>Refresh</span>
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              playButtonClick();
              onTrySkill({
                name: "new-skill",
                description: "Create a new skill for this workspace",
                filePath: "",
                baseDir: workspace.path,
                source: "project",
                enabled: true,
                disableModelInvocation: false,
                slashCommand: "/skill:new-skill",
              });
            }}
          >
            <PlusIcon />
            <span>New skill</span>
          </button>
        </div>
      </header>

      <div className="skills-main-grid">
        <section className="skills-main-list" aria-label="Skills list">
          <SkillsSidebar
            runtime={runtime}
            query={query}
            onQueryChange={onQueryChange}
            showDisabled={showDisabled}
            onShowDisabledChange={onShowDisabledChange}
            collapsedGroups={collapsedGroups}
            onToggleGroup={onToggleGroup}
            selectedSkillPath={selectedSkillPath}
            onSelectSkill={onSelectSkill}
          />
        </section>

        <div className="skill-detail">
          {selectedSkill ? (
            <SkillDetail
              skill={selectedSkill}
              onOpenFolder={onOpenSkillFolder}
              onToggle={onToggleSkill}
              onTry={onTrySkill}
            />
          ) : (
            <div className="empty-state">
              <h2>No skills found</h2>
              <p>Refresh runtime discovery to load workspace and user-level skills.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SkillDetailProps {
  readonly skill: RuntimeSkillRecord;
  readonly onOpenFolder: (filePath: string) => void;
  readonly onToggle: (filePath: string, enabled: boolean) => void;
  readonly onTry: (skill: RuntimeSkillRecord) => void;
}

function SkillDetail({ skill, onOpenFolder, onToggle, onTry }: SkillDetailProps) {
  return (
    <>
      <header className="skill-detail__header">
        <div className="skill-detail__identity">
          <span className="skill-detail__avatar">
            <SkillIcon />
          </span>
          <div className="skill-detail__heading">
            <div className="skill-detail__title-row">
              <h2>{titleCase(skill.name)}</h2>
              <span
                className={`skill-status skill-detail__status ${
                  skill.enabled
                    ? "skill-status--enabled skill-detail__status--enabled"
                    : "skill-status--disabled"
                }`}
              >
                <span className="skill-status__dot" />
                {skill.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="skill-detail__tags">
              <span className="skill-tag">{titleCase(skill.source)}</span>
              {skill.disableModelInvocation ? (
                <span className="skill-tag skill-tag--muted">Slash only</span>
              ) : null}
            </div>
            <p className="skill-detail__description">{skill.description}</p>
          </div>
        </div>
      </header>

      <div className="skill-detail__grid">
        <div className="skill-detail__panel skill-detail__panel--details">
          <h3 className="skill-detail__panel-title">Details</h3>
          <dl className="skill-detail__meta">
            <div>
              <dt>Source</dt>
              <dd>{titleCase(skill.source)}</dd>
            </div>
            <div>
              <dt>Slash</dt>
              <dd className="skill-detail__mono">{skill.slashCommand}</dd>
            </div>
            <div>
              <dt>Invocation</dt>
              <dd>{skill.disableModelInvocation ? "Slash only" : "Auto + slash"}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd className="skill-detail__mono skill-detail__path">{skill.filePath}</dd>
            </div>
          </dl>
        </div>

        <div className="skill-detail__panel skill-detail__panel--actions">
          <h3 className="skill-detail__panel-title">Actions</h3>
          <div className="skill-detail__action-stack">
            <button className="button button--primary" type="button" onClick={() => onTry(skill)}>
              Try skill
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => onOpenFolder(skill.filePath)}
            >
              <FolderIcon />
              <span>Open folder</span>
            </button>
            <button
              className={`button button--secondary ${
                skill.enabled ? "skill-detail__danger" : ""
              }`}
              type="button"
              onClick={() => onToggle(skill.filePath, !skill.enabled)}
            >
              {skill.enabled ? "Disable skill" : "Enable skill"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
