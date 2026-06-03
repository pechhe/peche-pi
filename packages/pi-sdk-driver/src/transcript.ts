export interface SessionTranscriptImageAttachment {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: string;
  readonly name?: string;
}

export interface SessionTranscriptFileAttachment {
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type SessionTranscriptAttachment = SessionTranscriptImageAttachment | SessionTranscriptFileAttachment;

export type SessionTranscriptRole = "user" | "assistant" | "branchSummary" | "compactionSummary";

export interface SessionTranscriptMessage {
  readonly kind: "message";
  readonly role: SessionTranscriptRole;
  readonly text: string;
  readonly attachments?: readonly SessionTranscriptAttachment[];
  readonly createdAt: string;
  readonly id: string;
}

/**
 * One iteration of a loop (e.g. a Ralph loop) reconstructed from the
 * `parentSession` ancestry chain. Ordered root-first; the final entry is the
 * live (active) iteration. A host stitches these into one composite loop
 * thread, inserting a divider before each iteration's messages.
 */
export interface LoopIterationTranscript {
  readonly label: string;
  readonly sessionId: string;
  readonly messages: readonly SessionTranscriptMessage[];
}
