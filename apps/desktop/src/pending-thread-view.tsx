import type { ComposerAttachment } from "./desktop-state";
import { FileIcon } from "./icons";
import { MessageMarkdown } from "./message-markdown";
import { WorkingLabel } from "./working-label";

export interface PendingThreadViewProps {
  readonly workspaceName: string;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly environment: "local" | "worktree";
}

/**
 * Placeholder session surface shown between the moment the user hits Enter
 * on the new-thread view and the moment the main process finishes spinning
 * up the agent runtime + initial snapshot refresh.
 *
 * Renders the same chrome as the real session view (eyebrow, title row,
 * conversation column, user bubble) so the transition feels like the
 * thread is already starting rather than a blocking dialog.
 */
export function PendingThreadView({
  workspaceName,
  prompt,
  attachments,
  environment,
}: PendingThreadViewProps) {
  const eyebrow =
    environment === "worktree"
      ? `${workspaceName} · New worktree`
      : `${workspaceName} · Local`;

  return (
    <section className="canvas canvas--thread canvas--pending">
      <div className="conversation conversation--thread">
        <div className="chat-header">
          <div className="chat-header__eyebrow">{eyebrow}</div>
          <div className="chat-header__row">
            <h1 className="chat-header__title">New thread</h1>
            <div className="chat-header__status">
              <WorkingLabel label="Starting…" />
            </div>
          </div>
        </div>

        <div className="timeline-pane timeline-pane--thread timeline-pane--pending">
          <div className="timeline">
            <article className="timeline-item timeline-item--user">
              <div className="timeline-item__bubble">
                {attachments.length > 0 ? (
                  <div className="timeline-item__attachments">
                    {attachments.map((attachment, index) =>
                      attachment.kind === "image" ? (
                        <img
                          alt={attachment.name ?? `Attachment ${index + 1}`}
                          className="timeline-item__attachment timeline-item__attachment--image"
                          key={`pending:${index}`}
                          src={`data:${attachment.mimeType};base64,${attachment.data}`}
                        />
                      ) : (
                        <div
                          className="timeline-item__attachment timeline-item__attachment--file"
                          key={`pending:${index}`}
                          title={attachment.fsPath}
                        >
                          <span className="timeline-item__attachment-icon" aria-hidden="true">
                            <FileIcon />
                          </span>
                          <span className="timeline-item__attachment-name">{attachment.name}</span>
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
                {prompt ? <MessageMarkdown text={prompt} /> : null}
              </div>
            </article>

            <div className="pending-thread__waiting" aria-live="polite">
              <WorkingLabel label="Preparing your thread…" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
