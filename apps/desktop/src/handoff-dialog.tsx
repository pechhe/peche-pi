import { useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import type { WorkspaceRecord } from "./desktop-state";
import { playButtonClick } from "./button-click-sound";
import { showToast } from "./toast";

interface HandoffDialogProps {
  readonly mode: "worktree" | "local";
  readonly branchName: string;
  readonly localWorkspace: WorkspaceRecord | undefined;
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

export function HandoffDialog({
  mode,
  branchName,
  localWorkspace,
  api,
  onClose,
  onSuccess,
}: HandoffDialogProps) {
  const [newBranchName, setNewBranchName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    if (mode === "worktree") {
      inputRef.current?.focus();
    }
  }, [mode]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;

    if (mode === "worktree") {
      // Hand off to worktree: create a new worktree with the branch
      const branch = newBranchName.trim();
      if (!branch) {
        setError("Branch name is required.");
        return;
      }
      if (!localWorkspace) {
        setError("No local workspace available.");
        return;
      }

      setSubmitting(true);
      setError(undefined);
      playButtonClick();

      try {
        await api.createWorktree({
          workspaceId: localWorkspace.id,
        });
        showToast({
          variant: "success",
          message: `Worktree created with branch: ${branch}`,
        });
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create worktree.");
        setSubmitting(false);
      }
    } else {
      // Hand off to local: checkout branch in local workspace and remove worktree
      if (!localWorkspace) {
        setError("No local workspace available.");
        return;
      }

      setSubmitting(true);
      setError(undefined);
      playButtonClick();

      try {
        // First checkout the branch in the local workspace
        const checkoutResult = await api.checkoutBranch(localWorkspace.id, branchName);
        if (!checkoutResult.success) {
          setError(checkoutResult.message);
          setSubmitting(false);
          return;
        }

        showToast({
          variant: "success",
          message: `Checked out branch: ${branchName} in local workspace`,
        });
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to hand off to local.");
        setSubmitting(false);
      }
    }
  };

  return (
    <div
      className="tree-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || submitting) return;
        onClose();
      }}
    >
      <div
        aria-modal="true"
        className="tree-modal handoff-dialog"
        data-testid="handoff-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-modal__header">
          <div>
            <div className="tree-modal__eyebrow">
              {mode === "worktree" ? "Worktree" : "Local"}
            </div>
            <h2 className="tree-modal__title">
              {mode === "worktree"
                ? "Hand off chat to worktree"
                : "Hand off chat to local"}
            </h2>
          </div>
          <button
            aria-label="Close handoff dialog"
            className="tree-modal__close"
            disabled={submitting}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="tree-modal__error error-banner" data-testid="handoff-dialog-error">
            {error}
          </div>
        ) : null}

        <div className="handoff-dialog__body">
          {mode === "worktree" ? (
            <>
              <p className="handoff-dialog__description">
                Create and check out a branch in a new worktree to continue working in parallel.
              </p>
              <label className="handoff-dialog__field">
                <span className="handoff-dialog__label">Branch name</span>
                <input
                  className="handoff-dialog__input"
                  data-testid="handoff-dialog-branch-input"
                  disabled={submitting}
                  placeholder="feature/my-new-branch"
                  ref={inputRef}
                  type="text"
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleSubmit();
                    }
                  }}
                />
              </label>
            </>
          ) : (
            <>
              <p className="handoff-dialog__description">
                Check out branch <strong>{branchName}</strong> in a local workspace
                and detach it from worktree.
              </p>
              {localWorkspace ? (
                <div className="handoff-dialog__workspace-info">
                  Handing off to local workspace: <strong>{localWorkspace.name}</strong>
                </div>
              ) : null}
            </>
          )}
        </div>

        <button
          className="handoff-dialog__submit"
          data-testid="handoff-dialog-submit"
          disabled={submitting || (mode === "worktree" && !newBranchName.trim())}
          type="button"
          onClick={() => void handleSubmit()}
        >
          {submitting
            ? mode === "worktree"
              ? "Creating worktree…"
              : "Checking out…"
            : "Hand off"}
        </button>
      </div>
    </div>
  );
}
