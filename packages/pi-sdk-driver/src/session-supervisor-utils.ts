import { basename } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type {
  SessionAttachment,
  SessionConfig,
  SessionContextUsage,
  SessionErrorInfo,
  SessionRef,
  SessionSnapshot,
  SessionStatus,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type { SessionQueuedMessage } from "@pi-gui/session-driver/types";
import type { LoopIterationTranscript, SessionTranscriptAttachment, SessionTranscriptMessage } from "./transcript.js";

const FILE_ATTACHMENT_BLOCK_START = "<pi-gui-file-attachments>";
const FILE_ATTACHMENT_BLOCK_END = "</pi-gui-file-attachments>";

export interface SnapshotSource {
  readonly ref: SessionRef;
  readonly workspace: WorkspaceRef;
  readonly title: string;
  readonly status: SessionStatus;
  readonly updatedAt: string;
  readonly archivedAt: string | undefined;
  readonly preview: string | undefined;
  readonly config: SessionConfig | undefined;
  readonly runningRunId: string | undefined;
  readonly queuedMessages: readonly SessionQueuedMessage[];
  readonly contextUsage: SessionContextUsage | undefined;
}

export function buildSnapshot(source: SnapshotSource): SessionSnapshot {
  return {
    ref: { ...source.ref },
    workspace: { ...source.workspace },
    title: source.title.trim() || deriveWorkspaceTitle(source.workspace),
    status: source.status,
    updatedAt: source.updatedAt,
    ...(source.archivedAt !== undefined ? { archivedAt: source.archivedAt } : {}),
    ...(source.preview !== undefined ? { preview: source.preview } : {}),
    ...(source.config ? { config: source.config } : {}),
    ...(source.runningRunId !== undefined ? { runningRunId: source.runningRunId } : {}),
    ...(source.contextUsage !== undefined ? { contextUsage: source.contextUsage } : {}),
    ...(source.queuedMessages.length > 0
      ? {
          queuedMessages: source.queuedMessages.map((message) => ({
            ...message,
            ...(message.attachments
              ? {
                  attachments: message.attachments.map((attachment: SessionAttachment) => ({ ...attachment })),
                }
              : {}),
          })),
        }
      : {}),
  };
}

export function deriveSessionConfig(sessionManager: {
  buildSessionContext(): {
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}): SessionConfig | undefined {
  const context = sessionManager.buildSessionContext();
  const config: SessionConfig = {
    ...(context.model ? { provider: context.model.provider, modelId: context.model.modelId } : {}),
    ...(context.thinkingLevel && context.thinkingLevel !== "off" ? { thinkingLevel: context.thinkingLevel } : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
}

export function forcePersistSession(sessionManager: object): void {
  const maybeRewrite = (sessionManager as { _rewriteFile?: () => void })._rewriteFile;
  if (!maybeRewrite) return;
  maybeRewrite.call(sessionManager);
  // _rewriteFile() writes the full session to disk with flag "w". We must also mark
  // the manager as flushed (mirroring SessionManager.setSessionFile), otherwise the
  // next _persist() still believes it owns the first write and re-opens the file with
  // flag "wx" — which now throws EEXIST because the file already exists on disk.
  (sessionManager as { flushed?: boolean }).flushed = true;
}

export function sessionKey(sessionRef: SessionRef): string {
  return `${sessionRef.workspaceId}:${sessionRef.sessionId}`;
}

export function deriveWorkspaceTitle(workspace: WorkspaceRef): string {
  return workspace.displayName?.trim() || basename(workspace.path) || workspace.path;
}

export function createWorkspaceRef(path: string, displayName?: string): WorkspaceRef {
  return {
    workspaceId: path,
    path,
    ...(displayName ? { displayName } : {}),
  };
}

export function titleFromSessionInfo(info: SessionInfo): string {
  const preferred = info.name?.trim();
  if (preferred) {
    return preferred;
  }

  const firstMessage = truncate(info.firstMessage, 72);
  if (firstMessage) {
    return firstMessage;
  }

  return basename(info.cwd || info.path);
}

export function previewFromSessionInfo(info: SessionInfo): string | undefined {
  const text = truncate(info.firstMessage || info.allMessagesText, 140);
  return text || undefined;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function extractPreview(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }

  const text = messageText(message);
  if (text) {
    return truncate(text);
  }

  if (typeof message.stopReason === "string" && typeof message.errorMessage === "string") {
    return truncate(message.errorMessage);
  }

  return undefined;
}

export function determineRunOutcome(messages: readonly unknown[]): {
  success: boolean;
  error?: SessionErrorInfo;
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }

    const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
    if (stopReason === "error" || stopReason === "aborted") {
      const rawMessage =
        typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0
          ? message.errorMessage
          : stopReason === "aborted"
            ? "Run aborted"
            : "Run failed";
      const messageText = summarizeRunError(rawMessage);
      return {
        success: false,
        error: {
          message: messageText,
          code: stopReason.toUpperCase(),
          ...(messageText !== rawMessage ? { details: { raw: rawMessage } } : {}),
        },
      };
    }
    break;
  }

  return { success: true };
}

export function toSessionErrorInfo(error: unknown, code: string): SessionErrorInfo {
  if (error instanceof Error) {
    return {
      message: summarizeRunError(error.message),
      code,
      details: {
        name: error.name,
        stack: error.stack,
        raw: error.message,
      },
    };
  }

  return {
    message: typeof error === "string" ? summarizeRunError(error) : "Unknown error",
    code,
    details: error,
  };
}

/**
 * Collapse noisy upstream provider errors into a single human-readable line.
 *
 * Provider rate-limit failures (Codex `usage_limit_reached`, raw 429 bodies)
 * arrive as a giant JSON blob with every rate-limit header inlined. Rendering
 * that verbatim — once per internal retry — is the "loud" failure mode we want
 * to avoid. We parse the payload and surface just the cause plus a reset ETA;
 * the raw text is preserved in `details.raw` for debugging.
 */
export function summarizeRunError(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return text;
  }
  const braceIndex = text.indexOf("{");
  if (braceIndex === -1) {
    return text;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(braceIndex));
  } catch {
    return text;
  }
  if (!isRecord(parsed)) {
    return text;
  }
  const errorObj = isRecord(parsed.error) ? parsed.error : parsed;
  const kind = typeof errorObj.type === "string" ? errorObj.type : undefined;
  if (kind === "usage_limit_reached") {
    const resetsIn =
      typeof errorObj.resets_in_seconds === "number" ? errorObj.resets_in_seconds : undefined;
    const suffix = resetsIn !== undefined ? ` — resets in ${formatResetDuration(resetsIn)}` : "";
    return `Usage limit reached${suffix}`;
  }
  if (typeof errorObj.message === "string" && errorObj.message.trim().length > 0) {
    return errorObj.message.trim();
  }
  return text;
}

function formatResetDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function truncate(value: string, limit = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

export function injectFileAttachmentPreamble(
  text: string,
  attachments: readonly SessionAttachment[] | undefined,
): string {
  const files = attachments?.filter((attachment): attachment is Extract<SessionAttachment, { readonly kind: "file" }> => attachment.kind === "file") ?? [];
  if (files.length === 0) {
    return text;
  }

  const payload = JSON.stringify({
    version: 1,
    files: files.map((attachment) => ({
      kind: "file" as const,
      name: attachment.name,
      mimeType: attachment.mimeType,
      fsPath: attachment.fsPath,
      ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
    })),
  });
  const block = `${FILE_ATTACHMENT_BLOCK_START}${payload}${FILE_ATTACHMENT_BLOCK_END}`;
  return text ? `${block}\n${text}` : block;
}

/**
 * Iteration number from a `ralph_loop` custom marker entry, or `undefined`
 * when the session carries no such marker. Used both to detect loop iteration
 * sessions and to label them.
 */
export function loopMarkerIteration(entries: readonly unknown[]): number | undefined {
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      (entry as { type?: unknown }).type === "custom" &&
      (entry as { customType?: unknown }).customType === "ralph_loop"
    ) {
      const data = (entry as { data?: unknown }).data;
      const iteration =
        typeof data === "object" && data !== null ? (data as { iteration?: unknown }).iteration : undefined;
      return typeof iteration === "number" ? iteration : undefined;
    }
  }
  return undefined;
}

const RALPH_PATH = /\.ralph\//;

/**
 * Whether a session's persisted entries contain a tool call that touched the
 * `.ralph/` bundle — i.e. this is the chat where the Ralph plan was written.
 * Scans `message` entries' assistant `toolCall` blocks and matches a `.ralph/`
 * path anywhere in the tool arguments (single- or multi-file edits nest paths
 * differently, so we match the serialized arguments rather than a fixed field).
 * Pure (no IO) so it can be unit tested.
 */
export function entriesEditedRalphPlan(entries: readonly unknown[]): boolean {
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message") {
      continue;
    }
    const message = (entry as { message?: unknown }).message;
    const content = isRecord(message) ? (message as { content?: unknown }).content : undefined;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (!isRecord(block) || block.type !== "toolCall") {
        continue;
      }
      const args = (block as { arguments?: unknown }).arguments;
      if (args !== undefined && RALPH_PATH.test(JSON.stringify(args))) {
        return true;
      }
    }
  }
  return false;
}

/** Project persisted message entries into the loose message shape transcriptFromMessages expects. */
function messagesFromEntries(entries: readonly unknown[]): unknown[] {
  const messages: unknown[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || (entry as { type?: unknown }).type !== "message") {
      continue;
    }
    const message = (entry as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) {
      continue;
    }
    messages.push({
      ...(message as Record<string, unknown>),
      id: (entry as { id?: unknown }).id,
      createdAt: (entry as { timestamp?: unknown }).timestamp,
    });
  }
  return messages;
}

export interface LoopSessionInfo {
  readonly path: string;
  readonly id: string;
  readonly parentSessionPath?: string | undefined;
  readonly modifiedIso: string;
}

export interface CollectLoopIterationsParams {
  readonly leafEntries: readonly unknown[];
  readonly leafSessionId: string;
  readonly leafMessages: readonly unknown[];
  readonly leafUpdatedAt: string;
  readonly leafSessionFile: string | undefined;
  readonly sessions: readonly LoopSessionInfo[];
  readonly readEntries: (path: string) => readonly unknown[];
}

/**
 * Reconstruct a loop's iterations from a leaf session and its `parentSession`
 * ancestry. Returns `null` when the leaf is not a loop iteration (no
 * `ralph_loop` marker). Otherwise returns iterations root-first with the live
 * leaf last; prior iterations are read from their persisted session files via
 * `readEntries`, the live iteration from in-memory `leafMessages`.
 *
 * Pure and file-IO-free (IO is injected via `readEntries`) so it can be unit
 * tested without standing up a live session runtime.
 */
export function collectLoopIterations(params: CollectLoopIterationsParams): LoopIterationTranscript[] | null {
  if (loopMarkerIteration(params.leafEntries) === undefined) {
    return null;
  }

  const byPath = new Map(params.sessions.map((info) => [info.path, info] as const));

  // Walk the parentSession chain leaf-first, then reverse to root-first.
  const ancestors: LoopSessionInfo[] = [];
  const seen = new Set<string>();
  let parentPath = params.leafSessionFile ? byPath.get(params.leafSessionFile)?.parentSessionPath : undefined;
  while (parentPath && byPath.has(parentPath) && !seen.has(parentPath)) {
    seen.add(parentPath);
    const info = byPath.get(parentPath)!;
    ancestors.push(info);
    parentPath = info.parentSessionPath;
  }
  ancestors.reverse();

  const iterations: LoopIterationTranscript[] = ancestors.map((info, index) => {
    const entries = params.readEntries(info.path);
    const iteration = loopMarkerIteration(entries) ?? index + 1;
    return {
      label: `Iteration ${iteration}`,
      sessionId: info.id,
      messages: transcriptFromMessages(messagesFromEntries(entries), info.modifiedIso),
    };
  });

  const leafIteration = loopMarkerIteration(params.leafEntries) ?? ancestors.length + 1;
  iterations.push({
    label: `Iteration ${leafIteration}`,
    sessionId: params.leafSessionId,
    messages: transcriptFromMessages(params.leafMessages, params.leafUpdatedAt),
  });
  return iterations;
}

export function transcriptFromMessages(messages: readonly unknown[], fallbackTimestamp = nowIso()): SessionTranscriptMessage[] {
  const transcript: SessionTranscriptMessage[] = [];

  for (const [index, message] of messages.entries()) {
    if (!isRecord(message)) {
      continue;
    }

    const role = message.role;
    if (role !== "user" && role !== "assistant" && role !== "branchSummary" && role !== "compactionSummary") {
      continue;
    }

    const text = messageText(message);
    const attachments = messageAttachments(message);
    if (!text) {
      if (attachments.length === 0) {
        continue;
      }
    }

    transcript.push({
      kind: "message",
      id: typeof message.id === "string" ? message.id : `${role}-${index}`,
      role,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
      createdAt: typeof message.createdAt === "string" ? message.createdAt : fallbackTimestamp,
    });
  }

  return transcript;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function messageText(message: Record<string, unknown>): string {
  if (message.role === "branchSummary" || message.role === "compactionSummary") {
    return typeof message.summary === "string" ? message.summary.trim() : "";
  }

  const { content } = message;
  if (typeof content === "string") {
    return stripSerializedFileAttachments(content, message.role).text.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? stripSerializedFileAttachments(part.text, message.role).text
          : "",
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function messageAttachments(message: Record<string, unknown>) {
  const { content } = message;
  if (typeof content === "string") {
    return stripSerializedFileAttachments(content, message.role).attachments;
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part) => {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      return stripSerializedFileAttachments(part.text, message.role).attachments;
    }

    if (!isRecord(part) || part.type !== "image" || typeof part.data !== "string" || typeof part.mimeType !== "string") {
      return [];
    }

    return [
      {
        kind: "image" as const,
        data: part.data,
        mimeType: part.mimeType,
        ...(typeof part.name === "string" ? { name: part.name } : {}),
      },
    ];
  });
}

function stripSerializedFileAttachments(
  text: string,
  role: unknown,
): { readonly text: string; readonly attachments: readonly SessionTranscriptAttachment[] } {
  if (role !== "user" || !text.startsWith(FILE_ATTACHMENT_BLOCK_START)) {
    return {
      text,
      attachments: [],
    };
  }

  const endIndex = text.indexOf(FILE_ATTACHMENT_BLOCK_END, FILE_ATTACHMENT_BLOCK_START.length);
  if (endIndex < 0) {
    return {
      text,
      attachments: [],
    };
  }

  const payload = text.slice(FILE_ATTACHMENT_BLOCK_START.length, endIndex);
  const remainder = text.slice(endIndex + FILE_ATTACHMENT_BLOCK_END.length).replace(/^\n+/, "");
  const attachments = parseSerializedFileAttachments(payload);
  if (attachments.length === 0) {
    return {
      text,
      attachments: [],
    };
  }

  return {
    text: remainder,
    attachments,
  };
}

function parseSerializedFileAttachments(payload: string): SessionTranscriptAttachment[] {
  try {
    const parsed = JSON.parse(payload) as { readonly version?: unknown; readonly files?: readonly unknown[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) {
      return [];
    }

    return parsed.files.flatMap((entry) => {
      if (!isRecord(entry) || entry.kind !== "file" || typeof entry.name !== "string" || typeof entry.mimeType !== "string" || typeof entry.fsPath !== "string") {
        return [];
      }

      return [
        {
          kind: "file" as const,
          name: entry.name,
          mimeType: entry.mimeType,
          fsPath: entry.fsPath,
          ...(typeof entry.sizeBytes === "number" ? { sizeBytes: entry.sizeBytes } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
