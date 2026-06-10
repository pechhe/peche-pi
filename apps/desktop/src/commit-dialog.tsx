import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PiDesktopApi } from "./ipc";

interface CommitDialogProps {
  readonly workspaceId: string;
  readonly api: PiDesktopApi;
  readonly branchName: string;
  readonly defaultModel?: string;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

type CommitAction = "commit" | "commit-push" | "push";

export function CommitDialog({
  workspaceId,
  api,
  branchName,
  defaultModel,
  onClose,
  onSuccess,
}: CommitDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [action, setAction] = useState<CommitAction | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messageInputRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !action) {
      event.preventDefault();
      onClose();
    }
  };

  const handleAction = async (selectedAction: CommitAction) => {
    if (action) return;
    setAction(selectedAction);
    setError(undefined);
    try {
      if (selectedAction === "push") {
        // Push only - no commit
        const result = await api.commitPushExecute(workspaceId, branchName);
        if (result.success) {
          onSuccess();
          onClose();
        } else {
          setError(result.message);
          setAction(undefined);
        }
      } else {
        // Commit (with or without push)
        const result = await api.commitPushExecute(workspaceId, branchName);
        if (result.success) {
          onSuccess();
          onClose();
        } else {
          setError(result.message);
          setAction(undefined);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
      setAction(undefined);
    }
  };

  return (
    <div
      className="tree-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || action) return;
        onClose();
      }}
    >
      <div
        aria-modal="true"
        className="tree-modal commit-dialog"
        data-testid="commit-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="commit-dialog__header">
          <div className="commit-dialog__branch-info">
            <span className="commit-dialog__branch-icon">⑂</span>
            <span className="commit-dialog__branch-text">{branchName}</span>
          </div>
          <button
            aria-label="Close commit dialog"
            className="tree-modal__close"
            disabled={!!action}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="tree-modal__error error-banner" data-testid="commit-dialog-error">
            {error}
          </div>
        ) : null}

        <div className="commit-dialog__form">
          <textarea
            aria-label="Commit message"
            className="commit-dialog__textarea"
            data-testid="commit-dialog-message"
            disabled={!!action}
            placeholder="Commit message (leave empty for auto-generate)"
            ref={messageInputRef}
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />

          <label className="commit-dialog__checkbox">
            <input
              checked={includeUnstaged}
              data-testid="commit-dialog-unstaged"
              disabled={!!action}
              type="checkbox"
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
            />
            <span>Include unstaged changes</span>
          </label>
        </div>

        <div className="commit-dialog__actions">
          <button
            className="commit-dialog__action-btn"
            data-testid="commit-dialog-commit"
            disabled={!!action}
            type="button"
            onClick={() => handleAction("commit")}
          >
            <span className="commit-dialog__action-icon">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="10" cy="10" r="3" />
                <path d="M10 7V3.5M10 13v3.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="commit-dialog__action-label">Commit</span>
            <kbd className="commit-dialog__action-shortcut">⌘↵</kbd>
          </button>

          <button
            className="commit-dialog__action-btn"
            data-testid="commit-dialog-commit-push"
            disabled={!!action}
            type="button"
            onClick={() => handleAction("commit-push")}
          >
            <span className="commit-dialog__action-icon">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M10 14V6M10 6L6 10M10 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 16h14" strokeLinecap="round" />
              </svg>
            </span>
            <span className="commit-dialog__action-label">Commit and push</span>
          </button>

          <button
            className="commit-dialog__action-btn"
            data-testid="commit-dialog-push"
            disabled={!!action}
            type="button"
            onClick={() => handleAction("push")}
          >
            <span className="commit-dialog__action-icon">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M10 14V6M10 6L6 10M10 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 16h14" strokeLinecap="round" />
              </svg>
            </span>
            <span className="commit-dialog__action-label">Push</span>
          </button>
        </div>

        {action ? (
          <div className="commit-dialog__status">
            {action === "push" ? "Pushing…" : "Committing…"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
