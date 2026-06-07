import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
import type { AppView, Automation, ChatRecord, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ChatIcon, ChevronDownIcon, ComposeIcon, ContextIcon, DoneIcon, ExtensionIcon, AutomationIcon, AutomationRunIcon, FolderIcon, ProjectIcon, RestoreIcon, SettingsIcon, SkillIcon, WorktreeIcon } from "./icons";
import { WorkingSpinner } from "./working-label";
import type { PiDesktopApi } from "./ipc";
import { formatRelativeTime } from "./string-utils";
import { playDoneSound } from "./done-sound";
import { fireDoneCelebration } from "./done-celebration";
import { playButtonClick } from "./button-click-sound";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { PENDING_THREAD_SESSION_ID, type ThreadGroup, type ThreadListEntry } from "./thread-groups";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "./desktop-state";
import type { SidebarResize } from "./hooks/use-sidebar-width";
import type { SidebarNavEntry } from "./hooks/build-sidebar-nav-list";

interface MovingHighlightState {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly ready: boolean;
  readonly visible: boolean;
}

function hiddenMovingHighlight(): MovingHighlightState {
  return { left: 0, top: 0, width: 0, height: 0, ready: false, visible: false };
}

function measureMovingHighlight(container: HTMLElement, target: HTMLElement): MovingHighlightState {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  return {
    left: targetRect.left - containerRect.left,
    top: targetRect.top - containerRect.top,
    width: targetRect.width,
    height: targetRect.height,
    ready: true,
    visible: true,
  };
}

function MovingSidebarHighlight({
  children,
  className,
  itemSelector,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly itemSelector: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hoveredItem = useRef<HTMLElement | null>(null);
  const [hoverIndicator, setHoverIndicator] = useState<MovingHighlightState>(hiddenMovingHighlight);
  const [activeIndicator, setActiveIndicator] = useState<MovingHighlightState>(hiddenMovingHighlight);
  const [pendingIndicator, setPendingIndicator] = useState<MovingHighlightState>(hiddenMovingHighlight);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  function setTarget(
    target: HTMLElement | null,
    setIndicator: (value: MovingHighlightState | ((previous: MovingHighlightState) => MovingHighlightState)) => void,
  ) {
    const container = ref.current;
    if (!container || !target) {
      setIndicator((previous) => previous.ready ? { ...previous, visible: false } : hiddenMovingHighlight());
      return;
    }

    setIndicator(measureMovingHighlight(container, target));
  }

  function updateActiveTarget() {
    const active = ref.current?.querySelector<HTMLElement>(".session-row--active, .sidebar__nav-item--active") ?? null;
    setTarget(active, setActiveIndicator);
    if (active && active === hoveredItem.current) {
      hoveredItem.current = null;
      setTarget(null, setHoverIndicator);
    }
    const pending = ref.current?.querySelector<HTMLElement>(".session-row--pending") ?? null;
    setTarget(pending, setPendingIndicator);
  }

  function itemFromTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const item = target.closest<HTMLElement>(itemSelector);
    if (!item) return null;
    if (item.classList.contains("session-row--active") || item.classList.contains("sidebar__nav-item--active")) {
      return null;
    }
    return item;
  }

  useEffect(() => {
    if (shouldAnimate || (!hoverIndicator.ready && !activeIndicator.ready && !pendingIndicator.ready)) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setShouldAnimate(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [activeIndicator.ready, hoverIndicator.ready, pendingIndicator.ready, shouldAnimate]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    updateActiveTarget();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      setTarget(hoveredItem.current, setHoverIndicator);
      updateActiveTarget();
    });
    observer.observe(container);
    for (const item of container.querySelectorAll<HTMLElement>(itemSelector)) {
      observer.observe(item);
    }

    // Re-measure the active indicator when the `--active` class moves between
    // items (e.g. selecting a different thread), since that re-render does not
    // trigger the ResizeObserver.
    let mutationObserver: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => updateActiveTarget());
      mutationObserver.observe(container, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [itemSelector]);

  // Scroll the pending row into view when it changes.
  useEffect(() => {
    if (!pendingIndicator.ready || !pendingIndicator.visible) return;
    const pendingEl = ref.current?.querySelector<HTMLElement>(".session-row--pending");
    pendingEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pendingIndicator.ready, pendingIndicator.visible, pendingIndicator.top]);

  return (
    <div
      ref={ref}
      className={`${className} sidebar-moving-highlight`}
      onPointerMove={(event) => {
        const next = itemFromTarget(event.target);
        if (next === hoveredItem.current) return;
        hoveredItem.current = next;
        setTarget(next, setHoverIndicator);
      }}
      onPointerLeave={() => {
        hoveredItem.current = null;
        setTarget(null, setHoverIndicator);
      }}
      onFocus={(event) => {
        const next = itemFromTarget(event.target);
        hoveredItem.current = next;
        setTarget(next, setHoverIndicator);
      }}
      onBlur={(event) => {
        const container = ref.current;
        if (container && event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
        hoveredItem.current = null;
        setTarget(null, setHoverIndicator);
      }}
    >
      <div
        aria-hidden="true"
        className="sidebar-moving-highlight__indicator sidebar-moving-highlight__indicator--hover"
        style={{
          transform: `translate3d(${hoverIndicator.left + 2}px, ${hoverIndicator.top + 2}px, 0)`,
          width: Math.max(0, hoverIndicator.width - 4),
          height: Math.max(0, hoverIndicator.height - 4),
          opacity: hoverIndicator.visible ? 1 : 0,
          transition: shouldAnimate
            ? "transform 350ms cubic-bezier(0.32, 1.15, 0.60, 1.00), width 250ms cubic-bezier(0.22, 1, 0.36, 1), height 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease"
            : "opacity 150ms ease",
        }}
      />
      <div
        aria-hidden="true"
        className="sidebar-moving-highlight__indicator sidebar-moving-highlight__indicator--active"
        style={{
          transform: `translate3d(${activeIndicator.left + 2}px, ${activeIndicator.top + 2}px, 0)`,
          width: Math.max(0, activeIndicator.width - 4),
          height: Math.max(0, activeIndicator.height - 4),
          opacity: activeIndicator.visible ? 1 : 0,
          transition: shouldAnimate
            ? "transform 350ms cubic-bezier(0.32, 1.15, 0.60, 1.00), width 250ms cubic-bezier(0.22, 1, 0.36, 1), height 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease"
            : "opacity 150ms ease",
        }}
      />
      <div
        aria-hidden="true"
        className="sidebar-moving-highlight__indicator sidebar-moving-highlight__indicator--pending"
        style={{
          transform: `translate3d(${pendingIndicator.left + 2}px, ${pendingIndicator.top + 2}px, 0)`,
          width: Math.max(0, pendingIndicator.width - 4),
          height: Math.max(0, pendingIndicator.height - 4),
          opacity: pendingIndicator.visible ? 1 : 0,
          transition: shouldAnimate
            ? "transform 350ms cubic-bezier(0.32, 1.15, 0.60, 1.00), width 250ms cubic-bezier(0.22, 1, 0.36, 1), height 250ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease"
            : "opacity 150ms ease",
        }}
      />
      {children}
    </div>
  );
}

interface SidebarProps {
  readonly resize: SidebarResize;
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly chats: readonly ChatRecord[];
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
  readonly onOpenContext: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onOpenKanban: () => void;
  readonly queueMode: boolean;
  readonly onSetQueueMode: (enabled: boolean) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onArchiveAllNonRunningSessions: (workspaceId: string, olderThanMs?: number) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onCreateChat: () => void;
  readonly onSelectChat: (chatId: string) => void;
  readonly onArchiveChat: (chatId: string) => void;
  readonly onUnarchiveChat: (chatId: string) => void;
  readonly onRemoveChat: (chatId: string) => void;
  readonly pendingSidebarSelection: SidebarNavEntry | null;
  readonly automations: readonly Automation[];
  readonly onOpenAutomations: (workspaceId?: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    resize,
    activeView,
    selectedWorkspace,
    selectedSession,
    chats,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThreadForWorkspace,
    onSetActiveView: _onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenContext,
    onOpenSettings,
    onOpenKanban,
    queueMode,
    onSetQueueMode,
    onArchiveSession,
    onArchiveAllNonRunningSessions,
    onSelectSession,
    onUnarchiveSession,
    onCreateChat,
    onSelectChat,
    onArchiveChat,
    onUnarchiveChat,
    onRemoveChat,
    pendingSidebarSelection,
    automations,
    onOpenAutomations,
  } = props;

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
        <MovingSidebarHighlight className="sidebar__nav" itemSelector=".sidebar__nav-item">
          <button
            className={`sidebar__nav-item ${activeView === "skills" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
          >
            <SkillIcon />
            <span>Skills</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "extensions" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
          >
            <ExtensionIcon />
            <span>Extensions</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "automations" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onOpenAutomations(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
          >
            <AutomationIcon />
            <span>Automations</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "context" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onOpenContext(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
          >
            <ContextIcon />
            <span>Context</span>
          </button>
          <button
            className={`sidebar__nav-item ${activeView === "settings" ? "sidebar__nav-item--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id); }}
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </MovingSidebarHighlight>
      </div>

      <div className="sidebar__section">
        <div className="section__head">
          <div className="section__title-row">
            <ProjectIcon /><span className="section__title">{queueMode ? "Queue" : activeView === "kanban" ? "Kanban" : "Projects"}</span>
            <div className="project-view-toggle" role="group" aria-label="Project view mode">
              <button
                className={`project-view-toggle__button ${activeView === "threads" && !queueMode ? "project-view-toggle__button--active" : ""}`}
                type="button"
                onClick={() => { playButtonClick(); onSetQueueMode(false); _onSetActiveView("threads"); }}
                aria-label="Threads view"
              >
                Threads
              </button>
              <button
                className={`project-view-toggle__button ${queueMode ? "project-view-toggle__button--active" : ""}`}
                type="button"
                onClick={() => { playButtonClick(); onSetQueueMode(true); _onSetActiveView("threads"); }}
                aria-label="Queue view"
              >
                Queue
              </button>
              <button
                className={`project-view-toggle__button ${activeView === "kanban" ? "project-view-toggle__button--active" : ""}`}
                type="button"
                onClick={() => { playButtonClick(); onSetQueueMode(false); onOpenKanban(); }}
                aria-label="Kanban view"
              >
                Kanban
              </button>
            </div>
          </div>
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
                    activeView={activeView}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onArchiveAllNonRunningSessions={onArchiveAllNonRunningSessions}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                    pendingSidebarSelection={pendingSidebarSelection}
                    onOpenAutomations={onOpenAutomations}
                  />
                ))}
                {orphanGroups.map((group) => (
                  <WorkspaceGroupContent
                    key={group.rootWorkspace.id}
                    group={group}
                    canDrag={false}
                    activeView={activeView}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onArchiveAllNonRunningSessions={onArchiveAllNonRunningSessions}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                    pendingSidebarSelection={pendingSidebarSelection}
                    onOpenAutomations={onOpenAutomations}
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
                    activeView={activeView}
                    selectedWorkspace={selectedWorkspace}
                    selectedSession={selectedSession}
                    linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                    wsMenu={wsMenu}
                    api={api}
                    onArchiveSession={onArchiveSession}
                    onArchiveAllNonRunningSessions={onArchiveAllNonRunningSessions}
                    onSelectSession={onSelectSession}
                    onUnarchiveSession={onUnarchiveSession}
                    onNewThreadForWorkspace={onNewThreadForWorkspace}
                    pendingSidebarSelection={pendingSidebarSelection}
                    onOpenAutomations={onOpenAutomations}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <div className="sidebar__section sidebar__chats">
        <div className="section__head">
          <div className="section__title-row">
            <ChatIcon />
            <span>Chats</span>
          </div>
          <div className="section__tools">
            <button
              aria-label="New chat"
              className="icon-button"
              type="button"
              onClick={onCreateChat}
            >
              <ComposeIcon />
            </button>
          </div>
        </div>
        {chats.length === 0 ? (
          <div className="sidebar__chats-empty">
            <p>No chats yet.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={onCreateChat}
            >
              New chat
            </button>
          </div>
        ) : (
          <SidebarChatsList
            chats={chats}
            selectedWorkspaceId={selectedWorkspace?.id ?? ""}
            onSelectChat={onSelectChat}
            onArchiveChat={onArchiveChat}
            onUnarchiveChat={onUnarchiveChat}
            onRemoveChat={onRemoveChat}
            pendingSidebarSelection={pendingSidebarSelection}
          />
        )}
      </div>
    </aside>
  );
}

/* ── Sortable workspace group wrapper ──────────────────── */

interface WorkspaceGroupProps {
  readonly group: ThreadGroup;
  readonly canDrag: boolean;
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly linkedWorktreeByWorkspaceId: Map<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onArchiveAllNonRunningSessions: (workspaceId: string, olderThanMs?: number) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onNewThreadForWorkspace: (rootWorkspaceId: string) => void;
  readonly pendingSidebarSelection: SidebarNavEntry | null;
  readonly onOpenAutomations: (workspaceId?: string) => void;
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
    activeView,
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    onArchiveSession,
    onArchiveAllNonRunningSessions,
    onSelectSession,
    onUnarchiveSession,
    onNewThreadForWorkspace,
    dragHandleProps,
    pendingSidebarSelection,
    onOpenAutomations,
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
            aria-label={`Automations for ${rootWorkspace.name}`}
            className="icon-button workspace-row__automation-button workspace-row__compose-button"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenAutomations(rootWorkspace.id);
            }}
          >
            <AutomationIcon />
          </button>
          <button
            aria-label={`New project in ${rootWorkspace.name}`}
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
              {threads.some((t) => t.session.status !== "running") ? (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      onArchiveAllNonRunningSessions(rootWorkspace.id),
                    )
                  }
                >
                  Archive all non‑running threads
                </button>
              ) : null}
              {threads.some((t) => t.session.status !== "running" && Date.now() - new Date(t.session.updatedAt).getTime() >= 3_600_000) ? (
                <button
                  className="workspace-menu__item"
                  type="button"
                  onClick={(event) =>
                    wsMenu.runWorkspaceMenuAction(event, () =>
                      onArchiveAllNonRunningSessions(rootWorkspace.id, 3_600_000),
                    )
                  }
                >
                  Archive inactive &gt; 1 hour
                </button>
              ) : null}
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
          <MovingSidebarHighlight className="session-list" itemSelector=".session-row">
            {threads.map((thread) => {
              const active =
                thread.session.id === PENDING_THREAD_SESSION_ID ||
                (activeView === "threads" &&
                  thread.workspaceId === selectedWorkspace?.id &&
                  thread.session.id === selectedSession?.id);
              const pending =
                pendingSidebarSelection?.kind === "thread" &&
                pendingSidebarSelection.workspaceId === thread.workspaceId &&
                pendingSidebarSelection.sessionId === thread.session.id;
              return (
                <ThreadSessionRow
                  key={`${thread.workspaceId}:${thread.session.id}`}
                  active={active}
                  pending={pending}
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
          </MovingSidebarHighlight>
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
                <span>Past</span>
                <span className="archived-thread-group__count">{archivedThreads.length}</span>
              </button>
              {archivedSectionOpen ? (
                <MovingSidebarHighlight className="session-list session-list--archived" itemSelector=".session-row">
                  {archivedThreads.map((thread) => {
                    const active =
                      activeView === "threads" &&
                      thread.workspaceId === selectedWorkspace?.id &&
                      thread.session.id === selectedSession?.id;
                    const pending =
                      pendingSidebarSelection?.kind === "thread" &&
                      pendingSidebarSelection.workspaceId === thread.workspaceId &&
                      pendingSidebarSelection.sessionId === thread.session.id;
                    return (
                      <ThreadSessionRow
                        key={`${thread.workspaceId}:${thread.session.id}`}
                        active={active}
                        pending={pending}
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
                </MovingSidebarHighlight>
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
  // Show the braille spinner continuously on the sidebar while the session
  // is running, regardless of whether the assistant has started producing
  // visible output. The spinner only stops when the task finishes (status
  // transitions away from "running").
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

/* ── Done moment (animation + sound + celebration) ───────────── */

// Total time the row animates before it leaves the active list. Keep in sync
// with the .session-row--completing animation in sidebar.css.
const DONE_ANIMATION_MS = 500;

interface ThreadSessionRowProps {
  readonly active: boolean;
  readonly pending?: boolean;
  readonly archived?: boolean;
  readonly thread: ThreadListEntry;
  readonly onAction: () => void;
  readonly onSelect: () => void;
}

const ThreadSessionRow = memo(function ThreadSessionRow({
  active,
  pending = false,
  archived = false,
  thread,
  onAction,
  onSelect,
}: ThreadSessionRowProps) {
  const indicatorVariant = sessionIndicatorVariant(thread);
  const [completing, setCompleting] = useState(false);

  const handleDone = (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (archived) {
      // Restore is instant; no celebratory moment needed.
      onAction();
      return;
    }
    if (completing) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    fireDoneCelebration(rect.left + rect.width / 2, rect.top + rect.height / 2);
    setCompleting(true);
    playDoneSound();
    // Let the "done" animation play before the row leaves the active list.
    window.setTimeout(() => onAction(), DONE_ANIMATION_MS);
  };

  return (
    <div
      className={`session-row ${active ? "session-row--active" : ""} ${pending ? "session-row--pending" : ""} ${completing ? "session-row--completing" : ""}`}
      data-sidebar-indicator={indicatorVariant}
      data-session-id={thread.session.id}
      onClick={onSelect}
    >
      <button className="session-row__select" onClick={onSelect} type="button">
        <span className="session-row__leading" aria-hidden="true">
          {indicatorVariant === "running" ? (
            <WorkingSpinner className="session-row__status session-row__status--running" title="Thinking…" />
          ) : null}
          {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
          {thread.session.automationId || thread.session.title.startsWith("⚡ ") ? (
            <span className="session-row__automation-indicator" aria-label="Automation" title="Created by automation">
              <AutomationRunIcon />
            </span>
          ) : null}
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
          aria-label={`${archived ? "Restore" : "Mark done"} ${thread.session.title}`}
          className={`icon-button session-row__action ${archived ? "" : "session-row__action--done"}`}
          type="button"
          onClick={handleDone}
        >
          {archived ? <RestoreIcon /> : <DoneIcon />}
        </button>
      </span>
    </div>
  );
}, sameThreadSessionRowProps);

function sameThreadSessionRowProps(previous: ThreadSessionRowProps, next: ThreadSessionRowProps): boolean {
  return (
    previous.active === next.active &&
    previous.pending === next.pending &&
    previous.archived === next.archived &&
    previous.thread.workspaceId === next.thread.workspaceId &&
    previous.thread.environment.kind === next.thread.environment.kind &&
    previous.thread.session.id === next.thread.session.id &&
    previous.thread.session.title === next.thread.session.title &&
    previous.thread.session.status === next.thread.session.status &&
    previous.thread.session.hasUnseenUpdate === next.thread.session.hasUnseenUpdate &&
    previous.thread.session.updatedAt === next.thread.session.updatedAt
  );
}

/* ── Chats list ───────────────────────────────────────────── */

function SidebarChatsList({
  chats,
  selectedWorkspaceId,
  onSelectChat,
  onArchiveChat,
  onUnarchiveChat,
  onRemoveChat,
  pendingSidebarSelection,
}: {
  readonly chats: readonly ChatRecord[];
  readonly selectedWorkspaceId: string;
  readonly onSelectChat: (chatId: string) => void;
  readonly onArchiveChat: (chatId: string) => void;
  readonly onUnarchiveChat: (chatId: string) => void;
  readonly onRemoveChat: (chatId: string) => void;
  readonly pendingSidebarSelection: SidebarNavEntry | null;
}) {
  const activeChats = chats.filter((c) => !c.archivedAt);
  const archivedChats = chats.filter((c) => c.archivedAt);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <>
      <MovingSidebarHighlight className="session-list" itemSelector=".session-row">
        {activeChats.map((chat) => {
          const isActive = Boolean(chat.chatWorkspaceId) && chat.chatWorkspaceId === selectedWorkspaceId;
          const pending = pendingSidebarSelection?.kind === "chat" && pendingSidebarSelection.sessionId === chat.id;
          return (
            <ChatRow
              key={chat.id}
              chat={chat}
              isActive={isActive}
              pending={pending}
              onSelect={() => onSelectChat(chat.id)}
              onArchive={() => onArchiveChat(chat.id)}
            />
          );
        })}
      </MovingSidebarHighlight>
      {archivedChats.length > 0 ? (
        <div className="archived-thread-group">
          <button
            aria-expanded={showArchived}
            className="archived-thread-group__toggle"
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
          >
            <span
              aria-hidden="true"
              className={`archived-thread-group__chevron ${showArchived ? "archived-thread-group__chevron--open" : ""}`}
            >
              <ChevronDownIcon />
            </span>
            <span>Past</span>
            <span className="archived-thread-group__count">{archivedChats.length}</span>
          </button>
          {showArchived ? (
            <MovingSidebarHighlight className="session-list session-list--archived" itemSelector=".session-row">
              {archivedChats.map((chat) => {
                const isActive = Boolean(chat.chatWorkspaceId) && chat.chatWorkspaceId === selectedWorkspaceId;
                const pending = pendingSidebarSelection?.kind === "chat" && pendingSidebarSelection.sessionId === chat.id;
                return (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    isActive={isActive}
                    pending={pending}
                    archived
                    onSelect={() => onSelectChat(chat.id)}
                    onUnarchive={() => onUnarchiveChat(chat.id)}
                    onRemove={() => onRemoveChat(chat.id)}
                  />
                );
              })}
            </MovingSidebarHighlight>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface ChatRowProps {
  readonly chat: ChatRecord;
  readonly isActive: boolean;
  readonly pending?: boolean;
  readonly archived?: boolean;
  readonly onSelect: () => void;
  readonly onArchive?: () => void;
  readonly onUnarchive?: () => void;
  readonly onRemove?: () => void;
}

const ChatRow = memo(function ChatRow({
  chat,
  isActive,
  pending = false,
  archived = false,
  onSelect,
  onArchive,
  onUnarchive,
  onRemove,
}: ChatRowProps) {
  const indicatorVariant: "running" | "unseen" | "none" =
    chat.status === "running" ? "running" : chat.hasUnseenUpdate ? "unseen" : "none";
  const [completing, setCompleting] = useState(false);

  const handleDone = (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (completing) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    fireDoneCelebration(rect.left + rect.width / 2, rect.top + rect.height / 2);
    setCompleting(true);
    playDoneSound();
    // Let the "done" animation play before the row leaves the active list.
    window.setTimeout(() => onArchive?.(), DONE_ANIMATION_MS);
  };

  return (
    <div
      className={`session-row ${isActive ? "session-row--active" : ""} ${pending ? "session-row--pending" : ""} ${completing ? "session-row--completing" : ""}`}
      data-sidebar-indicator={indicatorVariant}
      data-session-id={chat.id}
      onClick={onSelect}
    >
      <button className="session-row__select" onClick={onSelect} type="button">
        <span className="session-row__leading" aria-hidden="true">
          {indicatorVariant === "running" ? (
            <WorkingSpinner className="session-row__status session-row__status--running" title="Thinking…" />
          ) : null}
          {indicatorVariant === "unseen" ? <span className="session-row__status session-row__status--unseen" /> : null}
        </span>
        <span className="session-row__body">
          <span className="session-row__title-line">
            <span className="session-row__title">{chat.title}</span>
          </span>
        </span>
      </button>
      <span className="session-row__trailing">
        <span className="session-row__time">{formatRelativeTime(chat.updatedAt)}</span>
        {archived ? (
          <>
            <button
              aria-label={`Restore ${chat.title}`}
              className="icon-button session-row__action"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnarchive?.();
              }}
            >
              <RestoreIcon />
            </button>
            <button
              aria-label={`Delete ${chat.title}`}
              className="icon-button session-row__action"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove?.();
              }}
              style={{ right: "36px" }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </>
        ) : (
          <button
            aria-label={`Mark done ${chat.title}`}
            className="icon-button session-row__action session-row__action--done"
            type="button"
            onClick={handleDone}
          >
            <DoneIcon />
          </button>
        )}
      </span>
    </div>
  );
}, sameChatRowProps);

function sameChatRowProps(previous: ChatRowProps, next: ChatRowProps): boolean {
  return (
    previous.isActive === next.isActive &&
    previous.pending === next.pending &&
    previous.archived === next.archived &&
    previous.chat.id === next.chat.id &&
    previous.chat.title === next.chat.title &&
    previous.chat.updatedAt === next.chat.updatedAt &&
    previous.chat.status === next.chat.status &&
    previous.chat.hasUnseenUpdate === next.chat.hasUnseenUpdate &&
    previous.chat.archivedAt === next.chat.archivedAt &&
    previous.chat.chatWorkspaceId === next.chat.chatWorkspaceId
  );
}
