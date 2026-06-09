import type { ComposerAttachment, QueuedComposerMessage } from "./desktop-state";
import { FileIcon } from "./icons";
import { openImageLightbox } from "./image-lightbox";

interface QueuedComposerMessagesProps {
  readonly messages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly onEditMessage: (messageId: string) => void;
  readonly onRemoveMessage: (messageId: string) => void;
  readonly onSteerMessage: (messageId: string) => void;
  readonly onCancelEdit: () => void;
}

export function QueuedComposerMessages({
  messages,
  editingQueuedMessageId,
  onEditMessage,
  onRemoveMessage,
  onSteerMessage,
  onCancelEdit,
}: QueuedComposerMessagesProps) {
  if (messages.length === 0 && !editingQueuedMessageId) {
    return null;
  }

  // Filter out steer messages — they appear in the transcript, not the queue.
  const visibleMessages = messages.filter((message) => message.mode !== "steer");
  if (visibleMessages.length === 0 && !editingQueuedMessageId) {
    return null;
  }

  return (
    <div className="queued-composer-messages" data-testid="queued-composer-messages">
      {editingQueuedMessageId ? (
        <div className="queued-composer-messages__editing" data-testid="queued-composer-editing">
          <span>Editing queued message</span>
          <button type="button" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      ) : null}
      {visibleMessages.map((message, index) => (
        <div
          className={`queued-composer-message ${message.id === editingQueuedMessageId ? "queued-composer-message--editing" : ""}`}
          data-testid="queued-composer-message"
          key={message.id}
        >
          <div className="queued-composer-message__header">
            <span className="queued-composer-message__index" aria-hidden="true">
              {index + 1}
            </span>
            {message.text ? <div className="queued-composer-message__text">{message.text}</div> : null}
            <div className="queued-composer-message__actions">
              {message.mode !== "steer" ? (
                <button type="button" onClick={() => onSteerMessage(message.id)}>
                  Steer
                </button>
              ) : null}
              <button type="button" onClick={() => onEditMessage(message.id)}>
                Edit
              </button>
              <button aria-label={`Delete queued message ${message.text || message.id}`} type="button" onClick={() => onRemoveMessage(message.id)}>
                Delete
              </button>
            </div>
          </div>
          {message.attachments.length > 0 ? (
            <div className="queued-composer-message__attachments">
              {message.attachments.map((attachment, aIndex) => (
                <QueuedAttachmentPreview attachment={attachment} key={`${message.id}:${attachment.name}:${aIndex}`} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function QueuedAttachmentPreview({ attachment }: { readonly attachment: ComposerAttachment }) {
  return (
    <div className={`queued-composer-attachment queued-composer-attachment--${attachment.kind}`}>
      {attachment.kind === "image" ? (
        <button
          type="button"
          className="queued-composer-attachment__preview-button"
          aria-label={`View ${attachment.name}`}
          onClick={() =>
            openImageLightbox({
              src: `data:${attachment.mimeType};base64,${attachment.data}`,
              alt: attachment.name,
            })
          }
        >
          <img
            alt={attachment.name}
            className="queued-composer-attachment__preview"
            src={`data:${attachment.mimeType};base64,${attachment.data}`}
          />
        </button>
      ) : (
        <span className="queued-composer-attachment__icon" aria-hidden="true">
          <FileIcon />
        </span>
      )}
      <span className="queued-composer-attachment__name">{attachment.name}</span>
    </div>
  );
}
