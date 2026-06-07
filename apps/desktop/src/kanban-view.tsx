import { buildKanbanColumns } from "./kanban-board";
import { PENDING_THREAD_SESSION_ID, type ThreadGroup, type ThreadListEntry } from "./thread-groups";
import { WorkingSpinner } from "./working-label";
import { formatRelativeTime } from "./string-utils";
import { DoneIcon, RestoreIcon, WorktreeIcon } from "./icons";

interface KanbanViewProps {
  readonly threadGroups: readonly ThreadGroup[];
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
}

export function KanbanView({
  threadGroups,
  selectedWorkspaceId,
  selectedSessionId,
  onSelectSession,
  onArchiveSession,
  onUnarchiveSession,
}: KanbanViewProps) {
  const columns = buildKanbanColumns(threadGroups);

  return (
    <section className="kanban-surface" data-testid="kanban-surface">
      <header className="kanban-surface__header">
        <div>
          <div className="session-header__eyebrow">Project view</div>
          <h1>Kanban</h1>
        </div>
        <p>Track every project thread by current state. Pick card to jump back into transcript.</p>
      </header>
      <div className="kanban-board" data-testid="kanban-board">
        {columns.map((column) => (
          <section className={`kanban-column kanban-column--${column.id}`} key={column.id}>
            <header className="kanban-column__header">
              <div>
                <h2>{column.title}</h2>
                <p>{column.description}</p>
              </div>
              <span className="kanban-column__count">{column.threads.length}</span>
            </header>
            <div className="kanban-column__cards">
              {column.threads.length > 0 ? (
                column.threads.map((thread) => (
                  <KanbanCard
                    key={`${thread.workspaceId}:${thread.session.id}`}
                    thread={thread}
                    active={thread.workspaceId === selectedWorkspaceId && thread.session.id === selectedSessionId}
                    onSelect={() => onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })}
                    onAction={() => {
                      const target = { workspaceId: thread.workspaceId, sessionId: thread.session.id };
                      if (thread.session.archivedAt) {
                        onUnarchiveSession(target);
                      } else {
                        onArchiveSession(target);
                      }
                    }}
                  />
                ))
              ) : (
                <div className="kanban-column__empty">No threads here</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function KanbanCard({
  thread,
  active,
  onSelect,
  onAction,
}: {
  readonly thread: ThreadListEntry;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onAction: () => void;
}) {
  const isPending = thread.session.id === PENDING_THREAD_SESSION_ID;
  const archived = Boolean(thread.session.archivedAt);
  return (
    <article className={`kanban-card ${active ? "kanban-card--active" : ""}`}>
      <button className="kanban-card__body" type="button" onClick={onSelect} disabled={isPending}>
        <span className="kanban-card__topline">
          <span className="kanban-card__project">{thread.environment.label}</span>
          <span className="kanban-card__time">{formatRelativeTime(thread.session.updatedAt)}</span>
        </span>
        <strong className="kanban-card__title">{thread.session.title}</strong>
        {thread.session.preview ? <span className="kanban-card__preview">{thread.session.preview}</span> : null}
        <span className="kanban-card__meta">
          {thread.session.status === "running" ? (
            <span className="kanban-card__status"><WorkingSpinner /> Running</span>
          ) : thread.session.hasUnseenUpdate ? (
            <span className="kanban-card__status kanban-card__status--attention">Updated</span>
          ) : archived ? (
            <span className="kanban-card__status">Done</span>
          ) : (
            <span className="kanban-card__status">Idle</span>
          )}
          {thread.environment.kind === "worktree" ? (
            <span className="kanban-card__env"><WorktreeIcon /> {thread.environment.branchName ?? "Worktree"}</span>
          ) : null}
        </span>
      </button>
      {!isPending && thread.session.status !== "running" ? (
        <button
          className="kanban-card__action"
          type="button"
          aria-label={archived ? `Restore ${thread.session.title}` : `Mark ${thread.session.title} done`}
          onClick={onAction}
        >
          {archived ? <RestoreIcon /> : <DoneIcon />}
        </button>
      ) : null}
    </article>
  );
}
