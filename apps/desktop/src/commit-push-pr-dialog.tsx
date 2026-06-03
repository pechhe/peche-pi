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
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [draftMessage, setDraftMessage] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState(defaultBase);
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch draft on mount. Never blocks dialog rendering.
  useEffect(() => {
    let active = true;
    setLoadingDraft(true);
    void api
      .generatePrDraft(workspaceId, defaultBase || undefined)
      .then((result) => {
        if (!active) return;
        setTitle(result.title);
        setBody(result.body);
        setDraftMessage(result.message);
        setLoadingDraft(false);
      })
      .catch((err) => {
        if (!active) return;
        setDraftMessage(err instanceof Error ? err.message : "Failed to generate draft.");
        setLoadingDraft(false);
      });
    return () => {
      active = false;
    };
  }, [api, workspaceId, defaultBase]);

  // Focus title once it has content.
  useEffect(() => {
    if (!loadingDraft) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [loadingDraft]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!base.trim()) {
      setError("Base branch is required.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api.prCreate(workspaceId, {
        title: title.trim(),
        body,
        base: base.trim(),
        draft,
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
        className="tree-modal pr-dialog"
        data-testid="pr-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="tree-modal__header">
          <div>
            <div className="tree-modal__eyebrow">Pull request</div>
            <h2 className="tree-modal__title">Create PR</h2>
            <div className="tree-modal__meta" style={{ marginTop: 4 }}>
              {headBranch ? `${headBranch} → ${base || defaultBase}` : ""}
            </div>
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

        {draftMessage && !error ? (
          <div className="tree-modal__hint" data-testid="pr-dialog-draft-message">
            {draftMessage}
          </div>
        ) : null}

        <div className="pr-dialog__form">
          <label className="pr-dialog__field">
            <span className="pr-dialog__label">Title</span>
            <input
              aria-label="PR title"
              className="pr-dialog__input"
              data-testid="pr-dialog-title"
              disabled={loadingDraft || submitting}
              placeholder={loadingDraft ? "Generating draft…" : "PR title"}
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="pr-dialog__field">
            <span className="pr-dialog__label">Body</span>
            <textarea
              aria-label="PR body"
              className="pr-dialog__textarea"
              data-testid="pr-dialog-body"
              disabled={loadingDraft || submitting}
              placeholder={loadingDraft ? "Generating draft…" : "Markdown body"}
              rows={14}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <div className="pr-dialog__row">
            <label className="pr-dialog__field pr-dialog__field--inline">
              <span className="pr-dialog__label">Base</span>
              <input
                aria-label="Base branch"
                className="pr-dialog__input"
                data-testid="pr-dialog-base"
                disabled={submitting}
                type="text"
                value={base}
                onChange={(event) => setBase(event.target.value)}
              />
            </label>
            <label className="pr-dialog__checkbox">
              <input
                checked={draft}
                data-testid="pr-dialog-draft"
                disabled={submitting}
                type="checkbox"
                onChange={(event) => setDraft(event.target.checked)}
              />
              <span>Open as draft</span>
            </label>
          </div>
        </div>

        <div className="tree-modal__footer">
          <div className="tree-modal__hint">
            {submitting ? "Creating pull request…" : "Submits via `gh pr create`. Pushes upstream if needed."}
          </div>
          <div className="tree-modal__actions">
            <button
              className="button button--secondary"
              disabled={submitting}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              data-testid="pr-dialog-submit"
              disabled={submitting || loadingDraft || !title.trim() || !base.trim()}
              type="button"
              onClick={handleSubmit}
            >
              {submitting ? "Creating…" : "Create pull request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
