import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, ComposeIcon, ExtensionIcon, FolderIcon, RestoreIcon, SettingsIcon, SkillIcon, WorktreeIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime, titleCase } from "./string-utils";
import type { RuntimeSkillRecord } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { ThreadGroup, ThreadListEntry } from "./thread-groups";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "./desktop-state";
import type { SidebarResize } from "./hooks/use-sidebar-width";

/**
 * Skills payload. When provided alongside `activeView === "skills"`, the
 * sidebar renders a SKILLS section in place of the threads tree. Lives at the
 * App level so search/selection state survives route changes.
 */
export interface SidebarSkillsPayload {
  readonly skills: readonly RuntimeSkillRecord[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly showDisabled: boolean;
  readonly onShowDisabledChange: (value: boolean) => void;
  readonly selectedSkillPath: string | undefined;
  readonly onSelectSkill: (filePath: string) => void;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly onToggleGroup: (key: string) => void;
}

interface SidebarProps {
  readonly resize: SidebarResize;
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadGroups: readonly ThreadGroup[];
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onNewThreadForWorkspace: (rootWorkspaceId: string) => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly skillsPayload?: SidebarSkillsPayload;
}

export function Sidebar(props: SidebarProps) {
  const {
    resize,
    activeView,
    selectedWorkspace,
    selectedSession,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThreadForWorkspace,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onArchiveSession,
    onSelectSession,
    onUnarchiveSession,
    skillsPayload,
  } = props;
  const inSkillsMode = activeView === "skills" && skillsPayload != null;

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest ? [{ id: closest.id, data: { droppableContainer: args.droppableContainers.find((c) => String(c.id) === closest!.id)! } }] : [];
  };

  const rootGroups = threadGroups.filter((g) => g.rootWorkspace.kind === "primary");
  const orphanGroups = threadGroups.filter((g) => g.rootWorkspace.kind !== "primary");
  const rootGroupIds = rootGroups.map((g) => g.rootWorkspace.id);
  const canDrag = rootGroups.length > 1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    // Optimistically update local state to avoid snap-back animation
    setSnapshot((prev) => prev ? { ...prev, workspaceOrder: newOrder } : prev);
    void api.reorderWorkspaces(newOrder);
  }

  const activeGroup = activeId ? rootGroups.find((g) => g.rootWorkspace.id === activeId) : undefined;

  return (
    <aside className="sidebar">
      <div
        className={`sidebar__resize-handle ${resize.isResizing ? "sidebar__resize-handle--active" : ""}`}
        onPointerDown={resize.onPointerDown}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
      />
      <div className="sidebar__top">
        <div className="sidebar__nav">
          {activeView !== "threads" ? (
            <button
              className="sidebar__nav-item"
              type="button"
              onClick={() => onSetActiveView("threads")}
            >
              <span aria-hidden="true" className="sidebar__nav-back">←</span>
              <span>Threads</span>
            </button>
          ) : null}
          <button
            className={`sidebar__nav-item ${activeView === "skills" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SkillIcon />
            <span>Skills</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "extensions" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <ExtensionIcon />
            <span>Extensions</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "settings" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)}
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {inSkillsMode ? (
        <SkillsSidebarSection payload={skillsPayload!} />
      ) : (
      <div className="sidebar__section">
        <div className="section__head">
          <span>Threads</span>
          <div className="section__tools">
            <button
              aria-label="Open folder"
              className="icon-button"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              <FolderIcon />
            </button>
          </div>
        </div>

        {visibleWorkspaces.length === 0 ? (
          <div className="empty-state" data-testid="empty-state">
            <h2>No folders yet</h2>
            <p>Open a project folder to start building a workspace and session list.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                void updateSnapshot(api, setSnapshot, () => api.pickWorkspace());
              }}
            >
              Open first folder
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={headerCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
              <div className="workspace-list" data-testid="workspace-list">
                {rootGroups.map((group) => (
                  <SortableWorkspaceGroup
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={canDrag}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                  />
                ))}
                {orphanGroups.map((group) => (
                  <WorkspaceGroupContent
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeGroup ? (
                <div className="workspace-group workspace-group--overlay">
                  <WorkspaceGroupContent
                    group={activeGroup}
                    canDrag={false}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      )}
    </aside>
  );
}

/* ── Skills section (rendered inside the threads sidebar when active) ── */

interface SkillsSidebarSectionProps {
  readonly payload: SidebarSkillsPayload;
}

function SkillsSidebarSection({ payload }: SkillsSidebarSectionProps) {
  const {
    skills,
    query,
    onQueryChange,
    showDisabled,
    onShowDisabledChange,
    selectedSkillPath,
    onSelectSkill,
    collapsedGroups,
    onToggleGroup,
  } = payload;

  const normalized = query.trim().toLowerCase();
  const filtered = skills.filter((skill) => {
    if (!showDisabled && !skill.enabled) return false;
    if (!normalized) return true;
    return [skill.name, skill.description, skill.source, skill.slashCommand].some((value) =>
      value.toLowerCase().includes(normalized),
    );
  });

  const buckets = new Map<string, RuntimeSkillRecord[]>();
  for (const skill of filtered) {
    const key = skill.source || "other";
    const existing = buckets.get(key);
    if (existing) existing.push(skill);
    else buckets.set(key, [skill]);
  }
  const groups = Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      label: titleCase(key),
      skills: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <div className="sidebar__section sidebar__section--skills">
      <div className="section__head">
        <span>Skills</span>
      </div>
      <div className="sidebar-skills__controls">
        <input
          aria-label="Search skills"
          className="sidebar-skills__search"
          placeholder="Search skills…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <label className="sidebar-skills__toggle">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(event) => onShowDisabledChange(event.target.checked)}
          />
          <span>Show disabled</span>
        </label>
      </div>
      <div className="sidebar-skills__list" data-testid="skills-list">
        {groups.length === 0 ? (
          <div className="sidebar-skills__empty">No skills match your search.</div>
        ) : (
          groups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            return (
              <div className="sidebar-skills__group" key={group.key}>
                <button
                  type="button"
                  className="sidebar-skills__group-head"
                  onClick={() => onToggleGroup(group.key)}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  <span>{group.label}</span>
                  <span className="sidebar-skills__group-count">({group.skills.length})</span>
                </button>
                {collapsed ? null : (
                  <div className="sidebar-skills__group-items">
                    {group.skills.map((skill) => (
                      <button
                        key={skill.filePath}
                        type="button"
                        className={`sidebar-skills__row ${
                          selectedSkillPath === skill.filePath ? "sidebar-skills__row--active" : ""
                        }`}
                        onClick={() => onSelectSkill(skill.filePath)}
                      >
                        <span className="sidebar-skills__row-title">{titleCase(skill.name)}</span>
                        <span
                          className={`sidebar-skills__row-status ${
                            skill.enabled
                              ? "sidebar-skills__row-status--enabled"
                              : "sidebar-skills__row-status--disabled"
                          }`}
                          aria-label={skill.enabled ? "Enabled" : "Disabled"}
                          title={skill.enabled ? "Enabled" : "Disabled"}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="sidebar-skills__footer">
        <span>
          {skills.length} skill{skills.length === 1 ? "" : "s"}
        </span>
        <span className="sidebar-skills__footer-dot">•</span>
        <span>{enabledCount} enabled</span>
      </div>
    </div>
  );
}

/* ── Sortable workspace group wrapper ──────────────────── */

interface WorkspaceGroupProps {
  readonly group: ThreadGroup;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onNewThreadForWorkspace: (rootWorkspaceId: string) => void;
}

function SortableWorkspaceGroup(props: WorkspaceGroupProps) {
  const { group, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === group.rootWorkspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.rootWorkspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
    >
      <WorkspaceGroupContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

/* ── Workspace group content (used both inline and in overlay) ──── */

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceGroupContent(
  props: WorkspaceGroupProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const {
    group: { rootWorkspace, threads, archivedThreads },
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    onArchiveSession,
    onSelectSession,
    onUnarchiveSession,
    onNewThreadForWorkspace,
    dragHandleProps,
  } = props;

  const workspaceActive =
    rootWorkspace.id === selectedWorkspace?.id ||
    rootWorkspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(rootWorkspace.id);
  const archivedSectionOpen = wsMenu.expandedArchivedByWorkspace[rootWorkspace.id] ?? false;
  const isCollapsed = wsMenu.collapsedWorkspaces[rootWorkspace.id] ?? false;

  return (
    <>
      <div
        className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          wsMenu.openWorkspaceMenu(rootWorkspace.id);
        }}
      >
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => wsMenu.toggleWorkspaceCollapsed(rootWorkspace.id)}
          type="button"
          {...(dragHandleProps ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners } : {})}
        >
          <span className="workspace-row__icon" aria-hidden="true" data-collapsed={isCollapsed || undefined}>
            <span className="workspace-row__icon-folder"><FolderIcon /></span>
            <span className="workspace-row__icon-chevron"><ChevronDownIcon /></span>
          </span>
          <span className="workspace-row__name">{rootWorkspace.name}</span>
        </button>
        <span
          className="workspace-row__actions"
          data-menu-open={wsMenu.workspaceMenuId === rootWorkspace.id || undefined}
          ref={wsMenu.workspaceMenuId === rootWorkspace.id ? wsMenu.workspaceMenuWrapRef : undefined}
        >
          <button
            aria-label={`New thread in ${rootWorkspace.name}`}
            className="icon-button workspace-row__compose-button"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onNewThreadForWorkspace(rootWorkspace.id);
            }}
          >
            <ComposeIcon />
          </button>
          {wsMenu.workspaceMenuId === rootWorkspace.id ? (
            <div className="workspace-menu">
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) =>
                  wsMenu.runWorkspaceMenuAction(event, () => {
                    void api.openWorkspaceInFinder(rootWorkspace.id);
                  })
                }
              >
                Open folder
              </button>
              {linkedWorktree ? (
                <button
                  className="workspace-menu__item workspace-menu__item--danger"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      wsMenu.removeWorktree(linkedWorktree.rootWorkspaceId || rootWorkspace.id, linkedWorktree),
                    )
                  }
                >
                  Remove worktree
                </button>
              ) : (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () => wsMenu.createWorktree(rootWorkspace.id))
                  }
                >
                  Create permanent worktree
                </button>
              )}
              <button
                className="workspace-menu__item"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.startRename(rootWorkspace))}
              >
                Edit name
              </button>
              <button
                className="workspace-menu__item workspace-menu__item--danger"
                type="button"
                onClick={(event) => wsMenu.runWorkspaceMenuAction(event, () => wsMenu.removeWorkspace(rootWorkspace))}
              >
                Remove
              </button>
            </div>
          ) : null}
        </span>
      </div>
      {wsMenu.workspaceRenameId === rootWorkspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(rootWorkspace);
          }}
        >
          <input
            aria-label={`Rename ${rootWorkspace.name}`}
            className="workspace-rename__input"
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <div className="workspace-rename__actions">
            <button className="workspace-rename__button" type="button" onClick={wsMenu.cancelRename}>
              Cancel
            </button>
            <button className="workspace-rename__button workspace-rename__button--primary" type="submit">
              Save
            </button>
          </div>
        </form>
      ) : null}
      {!isCollapsed ? (
        <>
          <div className="session-list">
            {threads.map((thread) => {
              const active = thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
              return (
                <ThreadSessionRow
                  key={`${thread.workspaceId}:${thread.session.id}`}
                  active={active}
                  thread={thread}
                  onAction={() =>
                    onArchiveSession({
                      workspaceId: thread.workspaceId,
                      sessionId: thread.session.id,
                    })
                  }
                  onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                />
              );
            })}
          </div>
          {archivedThreads.length > 0 ? (
            <div className="archived-thread-group">
              <button
                aria-expanded={archivedSectionOpen}
                className="archived-thread-group__toggle"
                type="button"
                onClick={() => wsMenu.toggleArchived(rootWorkspace.id, !archivedSectionOpen)}
              >
                <span
                  aria-hidden="true"
                  className={`archived-thread-group__chevron ${archivedSectionOpen ? "archived-thread-group__chevron--open" : ""}`}
                >
                  <ChevronDownIcon />
                </span>
                <span>Archived</span>
                <span className="archived-thread-group__count">{archivedThreads.length}</span>
              </button>
              {archivedSectionOpen ? (
                <div className="session-list session-list--archived">
                  {archivedThreads.map((thread) => {
                    const active =
                      thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
                    return (
                      <ThreadSessionRow
                        key={`${thread.workspaceId}:${thread.session.id}`}
                        active={active}
                        archived
                        thread={thread}
                        onAction={() =>
                          onUnarchiveSession({
                            workspaceId: thread.workspaceId,
                            sessionId: thread.session.id,
                          })
                        }
                        onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/* ── Thread session row ────────────────────────────────── */

function sessionIndicatorVariant(thread: ThreadListEntry): "running" | "unseen" | "none" {
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

function ThreadSessionRow({
  active,
  archived = false,
  thread,
  onAction,
  onSelect,
}: {
  readonly active: boolean;
  readonly archived?: boolean;
  readonly thread: ThreadListEntry;
  readonly onAction: () => void;
  readonly onSelect: () => void;
}) {
  const indicatorVariant = sessionIndicatorVariant(thread);
  return (
    <div
      className={`session-row ${active ? "session-row--active" : ""}`}
      data-sidebar-indicator={indicatorVariant}
      data-session-id={thread.session.id}
      onClick={onSelect}
    >
      <button className="session-row__select" onClick={onSelect} type="button">
        <span className="session-row__leading" aria-hidden="true">
          {indicatorVariant === "running" ? <span className="session-row__status session-row__status--running" /> : null}
          {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
        </span>
        <span className="session-row__body">
          <span className="session-row__title-line">
            <span className="session-row__title">{thread.session.title}</span>
          </span>
        </span>
      </button>
      <span className="session-row__trailing">
        {thread.environment.kind === "worktree" ? (
          <span className="session-row__workspace-icon" aria-hidden="true" title="Worktree">
            <WorktreeIcon />
          </span>
        ) : null}
        <span className="session-row__time">{formatRelativeTime(thread.session.updatedAt)}</span>
        <button
          aria-label={`${archived ? "Restore" : "Archive"} ${thread.session.title}`}
          className="icon-button session-row__action"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
        >
          {archived ? <RestoreIcon /> : <ArchiveIcon />}
        </button>
      </span>
    </div>
  );
}
