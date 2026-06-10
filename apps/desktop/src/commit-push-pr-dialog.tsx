import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PiDesktopApi, PrMergeStatus } from "./ipc";

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

  // Post-creation state
  const [prNumber, setPrNumber] = useState<number | undefined>(undefined);
  const [prUrl, setPrUrl] = useState<string | undefined>(undefined);
  const [mergeStatus, setMergeStatus] = useState<PrMergeStatus | undefined>(undefined);
  const [checkingMerge, setCheckingMerge] = useState(false);
  const [merging, setMerging] = useState(false);

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
      if (result.success && result.number) {
        setPrNumber(result.number);
        setPrUrl(result.url);
        onSuccess(result.url);
        // Check merge status
        setCheckingMerge(true);
        try {
          const status = await api.checkPrMergeStatus(workspaceId, result.number);
          setMergeStatus(status.status);
        } catch {
          setMergeStatus("unknown");
        } finally {
          setCheckingMerge(false);
        }
      } else if (result.success) {
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

  const handleMerge = async () => {
    if (!prNumber || merging) return;
    setMerging(true);
    setError(undefined);
    try {
      const result = await api.mergePr(workspaceId, prNumber);
      if (result.success) {
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge PR.");
    } finally {
      setMerging(false);
    }
  };

  const handleOpenInBrowser = async () => {
    if (!prNumber) return;
    await api.openPrInBrowser(workspaceId, prNumber);
  };

  const created = prNumber !== undefined;

  return (
    <div
      className="tree-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || submitting || merging) return;
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
            disabled={submitting || merging}
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

        {!created ? (
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
        ) : (
          <div className="pr-dialog__status">
            <div className="pr-dialog__status-row">
              <span className="pr-dialog__status-label">PR #{prNumber} created</span>
              {prUrl ? (
                <a
                  className="pr-dialog__status-link"
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on GitHub
                </a>
              ) : null}
            </div>
            {checkingMerge ? (
              <div className="pr-dialog__status-hint">Checking merge status…</div>
            ) : mergeStatus === "mergeable" ? (
              <div className="pr-dialog__status-row pr-dialog__status-row--success">
                <span className="pr-dialog__status-badge pr-dialog__status-badge--green">✓ Ready to merge</span>
              </div>
            ) : mergeStatus === "conflicts" ? (
              <div className="pr-dialog__status-row pr-dialog__status-row--warn">
                <span className="pr-dialog__status-badge pr-dialog__status-badge--red">✗ Has conflicts</span>
              </div>
            ) : null}
          </div>
        )}

        <div className="pr-dialog__footer">
          {!created ? (
            <button
              className="button button--primary pr-dialog__submit"
              data-testid="pr-dialog-submit"
              disabled={submitting || !base.trim()}
              type="button"
              onClick={handleSubmit}
            >
              {submitting ? "Creating…" : "Create PR"}
            </button>
          ) : mergeStatus === "mergeable" ? (
            <button
              className="button button--primary pr-dialog__submit"
              data-testid="pr-dialog-merge"
              disabled={merging}
              type="button"
              onClick={handleMerge}
            >
              {merging ? "Merging…" : "Merge"}
            </button>
          ) : mergeStatus === "conflicts" ? (
            <button
              className="button button--primary pr-dialog__submit"
              data-testid="pr-dialog-open"
              type="button"
              onClick={handleOpenInBrowser}
            >
              Open in GitHub
            </button>
          ) : (
            <button
              className="button button--secondary pr-dialog__submit"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
