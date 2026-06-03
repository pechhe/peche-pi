import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  SessionMessageDeliveryMode,
  SessionMessageInput,
  SessionQueuedMessage,
} from "@pi-gui/session-driver/types";
import { injectFileAttachmentPreamble, messageText } from "./session-supervisor-utils.js";

export interface QueuedPromptImage {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export type QueuedPromptSession = Pick<AgentSession, "steer" | "followUp">;

export interface QueuedMessageReconciliationResult {
  readonly queuedMessages: SessionQueuedMessage[];
  readonly started: SessionQueuedMessage | undefined;
}

export function cloneQueuedMessage(message: SessionQueuedMessage): SessionQueuedMessage {
  return {
    ...message,
    ...(message.attachments
      ? {
          attachments: message.attachments.map((attachment: NonNullable<SessionQueuedMessage["attachments"]>[number]) => ({ ...attachment })),
        }
      : {}),
  };
}

export function queuedMessageFromInput(input: SessionMessageInput, timestamp: string): SessionQueuedMessage {
  return {
    id: crypto.randomUUID(),
    mode: input.deliverAs!,
    text: input.text,
    ...(input.attachments
      ? {
          attachments: input.attachments.map((attachment) => ({ ...attachment })),
        }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function queuedPromptImagesFromAttachments(
  attachments: SessionMessageInput["attachments"] | SessionQueuedMessage["attachments"],
): QueuedPromptImage[] | undefined {
  const images = attachments?.flatMap((attachment) =>
    attachment.kind === "image"
      ? [{
          type: "image" as const,
          data: attachment.data,
          mimeType: attachment.mimeType,
        }]
      : [],
  );

  return images && images.length > 0 ? images : undefined;
}

export function promptTextForQueuedDelivery(
  text: string,
  attachments: SessionMessageInput["attachments"] | SessionQueuedMessage["attachments"],
): string {
  return injectFileAttachmentPreamble(text, attachments);
}

export async function deliverQueuedPrompt(
  session: QueuedPromptSession,
  text: string,
  deliverAs: SessionMessageDeliveryMode,
  images?: readonly QueuedPromptImage[],
): Promise<void> {
  if (deliverAs === "steer") {
    await session.steer(text, images ? [...images] : undefined);
    return;
  }
  await session.followUp(text, images ? [...images] : undefined);
}

export async function deliverQueuedMessage(session: QueuedPromptSession, message: SessionQueuedMessage): Promise<void> {
  await deliverQueuedPrompt(
    session,
    promptTextForQueuedDelivery(message.text, message.attachments),
    message.mode,
    queuedPromptImagesFromAttachments(message.attachments),
  );
}

export function reconcileQueuedMessagesForStartedUserMessage(
  queuedMessages: readonly SessionQueuedMessage[],
  message: unknown,
): QueuedMessageReconciliationResult {
  if (typeof message !== "object" || message === null) {
    return { queuedMessages: [...queuedMessages], started: undefined };
  }

  const text = messageText(message as Record<string, unknown>);
  if (!text) {
    return { queuedMessages: [...queuedMessages], started: undefined };
  }

  const steeringIndex = queuedMessages.findIndex((item) => item.mode === "steer" && item.text === text);
  if (steeringIndex !== -1) {
    const queuedMessagesCopy = [...queuedMessages];
    const [started] = queuedMessagesCopy.splice(steeringIndex, 1);
    return { queuedMessages: queuedMessagesCopy, started };
  }

  const followUpIndex = queuedMessages.findIndex((item) => item.mode === "followUp" && item.text === text);
  if (followUpIndex !== -1) {
    const queuedMessagesCopy = [...queuedMessages];
    const [started] = queuedMessagesCopy.splice(followUpIndex, 1);
    return { queuedMessages: queuedMessagesCopy, started };
  }

  return { queuedMessages: [...queuedMessages], started: undefined };
}
