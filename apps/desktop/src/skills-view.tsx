import { useMemo } from "react";
import type { RuntimeSkillRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { ChevronDown, ChevronRight, FolderOpen, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { WorkspaceRecord } from "./desktop-state";
import { titleCase } from "./string-utils";
import { playButtonClick } from "./button-click-sound";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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

function StatusBadge({ enabled, className }: { enabled: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "skill-status inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        enabled
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", enabled ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Skill list rail
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
  const allSkills = useMemo(() => runtime?.skills ?? [], [runtime?.skills]);
  const filtered = useMemo(
    () => filterSkills(allSkills, query, showDisabled),
    [allSkills, query, showDisabled],
  );
  const groups = useMemo(() => groupSkills(filtered), [filtered]);
  const enabledCount = allSkills.filter((skill) => skill.enabled).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <input
        aria-label="Search skills"
        className="settings-search w-full"
        placeholder="Search skills, sources, or descriptions…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <label className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
        <Switch checked={showDisabled} onCheckedChange={onShowDisabledChange} aria-label="Show disabled" />
        <span>Show disabled</span>
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="skills-list">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            No skills match your search.
          </div>
        ) : (
          groups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <div className="mb-3" key={group.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
                  onClick={() => { playButtonClick(); onToggleGroup(group.key); }}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  <span>{group.label}</span>
                  <span className="font-normal">({group.skills.length})</span>
                </button>
                {collapsed ? null : (
                  <div className="mt-1 grid gap-1">
                    {group.skills.map((skill) => (
                      <button
                        key={skill.filePath}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                          selectedSkillPath === skill.filePath
                            ? "border-brand/40 bg-brand/10"
                            : "border-transparent hover:bg-accent/50",
                        )}
                        onClick={() => { playButtonClick(); onSelectSkill(skill.filePath); }}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                          <Sparkles />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">{titleCase(skill.name)}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{skill.description}</span>
                        </span>
                        {skill.enabled ? null : (
                          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" title="Disabled" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-border px-1 pt-2 text-[12px] text-muted-foreground">
        <span>
          {allSkills.length} skill{allSkills.length === 1 ? "" : "s"}
        </span>
        <span>•</span>
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
  const allSkills = useMemo(() => runtime?.skills ?? [], [runtime?.skills]);
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
    <div className="skills-view mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col animate-in fade-in duration-300">
      <header className="view-header">
        <div>
          <div className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Skills</div>
          <h1 className="view-header__title">Skills</h1>
          <p className="view-header__body">
            Give pi workspace-specific capabilities and reusable workflows.
          </p>
        </div>
        <div className="view-header__actions">
          <button className="button button--secondary" type="button" onClick={() => { playButtonClick(); onRefresh(); }}>
            <RefreshCw className="size-4" />
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
            <Plus className="size-4" />
            <span>New skill</span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        <section className="min-h-0 rounded-xl border border-border bg-card p-3" aria-label="Skills list">
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

        <div className="skill-detail min-h-0 overflow-y-auto rounded-xl border border-border bg-card p-5">
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
    <div key={skill.filePath} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      <header className="mb-5 flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&_svg]:size-5.5">
          <Sparkles />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-lg font-semibold tracking-tight text-foreground">{titleCase(skill.name)}</h2>
            <StatusBadge enabled={skill.enabled} className="skill-detail__status" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{titleCase(skill.source)}</span>
            {skill.disableModelInvocation ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground/70">Slash only</span>
            ) : null}
          </div>
          <p className="mt-2 mb-0 text-[13.5px] leading-relaxed text-muted-foreground">{skill.description}</p>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 max-[760px]:grid-cols-1">
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <h3 className="mt-0 mb-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Details</h3>
          <dl className="m-0 grid gap-2.5 text-[13px]">
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="m-0 text-foreground">{titleCase(skill.source)}</dd>
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">Slash</dt>
              <dd className="m-0 font-mono text-[12.5px] text-foreground">{skill.slashCommand}</dd>
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">Invocation</dt>
              <dd className="m-0 text-foreground">{skill.disableModelInvocation ? "Slash only" : "Auto + slash"}</dd>
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">Path</dt>
              <dd className="m-0 font-mono text-[12px] break-all text-muted-foreground">{skill.filePath}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-4">
          <h3 className="mt-0 mb-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Actions</h3>
          <div className="grid gap-2">
            <button className="button button--primary" type="button" onClick={() => onTry(skill)}>
              Try skill
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => onOpenFolder(skill.filePath)}
            >
              <FolderOpen className="size-4" />
              <span>Open folder</span>
            </button>
            <button
              className={cn("button button--secondary", skill.enabled && "text-destructive")}
              type="button"
              onClick={() => onToggle(skill.filePath, !skill.enabled)}
            >
              {skill.enabled ? "Disable skill" : "Enable skill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
