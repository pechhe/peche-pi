import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PiDesktopApi } from "./ipc";

interface CommitPushPrDialogProps {
  readonly workspaceId: string;
  readonly api: PiDesktopApi;
  readonly defaultBase: string;
  readonly headBranch: string;
  readonly onClose: () => void;
  readonly onSuccess: (url: string | undefined) => void;
}

export function CommitPushPrDialog({
  workspaceId,
  api,
  defaultBase,
  headBranch,
  onClose,
  onSuccess,
}: CommitPushPrDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base] = useState(defaultBase);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!base.trim()) {
      setError("Base branch is required.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api.prCreate(workspaceId, {
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        base: base.trim(),
      });
      if (result.success) {
        onSuccess(result.url);
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PR.");
    } finally {
      setSubmitting(false);
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
        className="tree-modal pr-dialog pr-dialog--compact"
        data-testid="pr-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="pr-dialog__header">
          <div className="pr-dialog__branch-info">
            <span className="pr-dialog__branch-icon">⑂</span>
            <span className="pr-dialog__branch-text">
              {headBranch ? `${headBranch} → ${base || defaultBase}` : ""}
            </span>
          </div>
          <button
            aria-label="Close PR dialog"
            className="tree-modal__close"
            disabled={submitting}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="tree-modal__error error-banner" data-testid="pr-dialog-error">
            {error}
          </div>
        ) : null}

        <div className="pr-dialog__form">
          <input
            aria-label="PR title"
            className="pr-dialog__input"
            data-testid="pr-dialog-title"
            disabled={submitting}
            placeholder="Title"
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <textarea
            aria-label="PR body"
            className="pr-dialog__textarea"
            data-testid="pr-dialog-body"
            disabled={submitting}
            placeholder="Description (leave empty to generate)"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div className="pr-dialog__footer">
          <button
            className="button button--primary pr-dialog__submit"
            data-testid="pr-dialog-submit"
            disabled={submitting || !base.trim()}
            type="button"
            onClick={handleSubmit}
          >
            {submitting ? "Creating…" : "Create PR"}
          </button>
        </div>
      </div>
    </div>
  );
}
