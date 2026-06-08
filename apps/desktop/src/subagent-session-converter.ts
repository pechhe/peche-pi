/**
 * Convert raw session `.jsonl` entries (as returned by
 * `api.getSubagentSessionEntries`) into the renderer's rich `TranscriptMessage[]`
 * so a subagent's session can be rendered read-only in the same
 * `ConversationTimeline` used for live threads.
 *
 * The live timeline is normally built incrementally from streaming session
 * events (see `app-store-timeline.ts`); a subagent runs in its own process, so
 * the only source we have is its persisted session file. This walks the message
 * entries and produces message / reasoning / tool items, pairing each assistant
 * `toolCall` with its later `toolResult` by call id.
 */

import type { TranscriptMessage } from "./timeline-types";
import { completedToolLabel, runningToolLabel } from "./timeline-model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("")
    .trim();
}

/**
 * For subagents forked with copied parent context, the runtime injects a
 * `subagent_boundary` marker entry: everything before it is inherited parent
 * background, everything after is the subagent's own work. The session panel
 * should show only the subagent's work, so we drop everything up to and
 * including that marker. Agents without copied context (lineage-only /
 * standalone, or with the boundary disabled) have no marker — render all.
 */
function entriesAfterChildContextBoundary(entries: readonly unknown[]): readonly unknown[] {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (isRecord(entry) && entry.customType === "subagent_boundary") {
      return entries.slice(i + 1);
    }
  }
  return entries;
}

export function subagentEntriesToTranscript(entries: readonly unknown[]): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = [];
  // callId -> index into transcript, so a later toolResult can complete the row.
  const toolIndexByCallId = new Map<string, number>();

  for (const entry of entriesAfterChildContextBoundary(entries)) {
    if (!isRecord(entry) || entry.type !== "message") continue;
    const message = entry.message;
    if (!isRecord(message)) continue;

    const createdAt =
      typeof entry.timestamp === "string"
        ? entry.timestamp
        : new Date(typeof message.timestamp === "number" ? message.timestamp : Date.now()).toISOString();
    const idBase = typeof entry.id === "string" ? entry.id : `msg-${transcript.length}`;
    const role = message.role;

    if (role === "toolResult") {
      const callId = typeof message.toolCallId === "string" ? message.toolCallId : "";
      const idx = callId ? toolIndexByCallId.get(callId) : undefined;
      if (idx === undefined) continue;
      const existing = transcript[idx];
      if (!existing || existing.kind !== "tool") continue;
      const status: "success" | "error" = message.isError === true ? "error" : "success";
      const output = contentText(message.content);
      transcript[idx] = {
        ...existing,
        status,
        label: completedToolLabel(existing.toolName, existing.input, status),
        output: output || existing.output,
      };
      continue;
    }

    if (role !== "user" && role !== "assistant") continue;

    const content = message.content;

    if (role === "user") {
      const text = contentText(content);
      if (text) {
        transcript.push({ kind: "message", id: idBase, role: "user", text, createdAt });
      }
      continue;
    }

    // assistant: walk parts in order — thinking → reasoning, text → message,
    // toolCall → running tool row (completed later by its toolResult).
    const parts = Array.isArray(content) ? content : [];
    let partIndex = 0;
    for (const part of parts) {
      if (!isRecord(part)) continue;
      partIndex += 1;
      if (part.type === "thinking") {
        const t = part.thinking;
        if (typeof t === "string" && t.trim()) {
          transcript.push({ kind: "reasoning", id: `${idBase}-think-${partIndex}`, text: t, createdAt });
        }
      } else if (part.type === "text") {
        const t = part.text;
        if (typeof t === "string" && t.trim()) {
          transcript.push({ kind: "message", id: `${idBase}-text-${partIndex}`, role: "assistant", text: t, createdAt });
        }
      } else if (part.type === "toolCall") {
        const callId = typeof part.id === "string" ? part.id : `${idBase}-tool-${partIndex}`;
        const toolName = typeof part.name === "string" ? part.name : "tool";
        transcript.push({
          kind: "tool",
          id: callId,
          callId,
          toolName,
          status: "running",
          label: runningToolLabel(toolName, part.arguments),
          input: part.arguments,
          createdAt,
        });
        toolIndexByCallId.set(callId, transcript.length - 1);
      }
    }
  }

  return transcript;
}
