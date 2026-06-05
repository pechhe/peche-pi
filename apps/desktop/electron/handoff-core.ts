/**
 * Handoff Core — the deep module for context compression and session seeding.
 *
 * Pure functions for payload shaping, plus thin orchestration helpers that
 * delegate I/O to the app-store and driver. Both the advisor side panel and
 * the general handoff flow share this module.
 *
 * Runs in the main process. No Electron imports — IPC wiring lives elsewhere.
 */

import type { SessionRef } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../src/desktop-state";
import type { SmartCompactSettings } from "../src/ipc";
import { parseProviderAndModel, resolveProviderConfig } from "./llm-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HandoffScope = "compressed" | "full" | "plan" | "selection";

export interface BuildHandoffPayloadInput {
  readonly sessionRef: SessionRef;
  readonly scope: HandoffScope;
  readonly quotedText?: string;
  readonly userNote?: string;
  readonly framing?: string;
}

export interface HandoffPayload {
  readonly seedText: string;
  readonly scope: HandoffScope;
  readonly tokenEstimate: number;
}

export interface CreateSeededSessionInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly seedText: string;
  readonly model?: string;
}

export interface CreateSeededSessionResult {
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// Advisor system framing
// ---------------------------------------------------------------------------

const ADVISOR_FRAMING =
  `You are an advisor reviewing a conversation to provide a second opinion. ` +
  `Your job is to do a deeper dive into the topic, consider alternatives the ` +
  `original conversation may have missed, and provide thoughtful, actionable ` +
  `advice. Be direct and specific. If you see a better approach, say so.`;

const QUESTIONNAIRE_ADVISOR_FRAMING =
  `You are an advisor helping a user decide between options in a questionnaire. ` +
  `Analyze each option's tradeoffs, consider the context of the conversation so far, ` +
  `and recommend the best choice with clear reasoning. Be direct.`;

// ---------------------------------------------------------------------------
// Token estimation (rough: 4 chars ≈ 1 token)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Transcript serialization — flatten TranscriptMessage[] to readable text
// ---------------------------------------------------------------------------

export function serializeTranscript(transcript: readonly TranscriptMessage[]): string {
  const lines: string[] = [];
  for (const msg of transcript) {
    if ("kind" in msg) {
      switch (msg.kind) {
        case "message": {
          const role = "role" in msg ? (msg as { role: string }).role : "unknown";
          const text = "text" in msg ? (msg as { text: string }).text : "";
          if (text) {
            lines.push(`[${role}]: ${text}`);
          }
          break;
        }
        case "tool": {
          const toolName = "toolName" in msg ? (msg as { toolName: string }).toolName : "tool";
          const label = "label" in msg ? (msg as { label: string }).label : "";
          lines.push(`[tool: ${toolName}] ${label}`);
          break;
        }
        case "summary": {
          const label = "label" in msg ? (msg as { label: string }).label : "";
          if (label) lines.push(`[summary] ${label}`);
          break;
        }
        case "activity": {
          const label = "label" in msg ? (msg as { label: string }).label : "";
          // Skip noisy activity items
          if (label && !("noise" in msg && msg.noise)) {
            lines.push(`[activity] ${label}`);
          }
          break;
        }
        case "reasoning": {
          // Skip reasoning in serialized output — too verbose for summary
          break;
        }
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LLM summarization — produces structured summary from transcript
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT =
  `You are a conversation summarizer. Given a transcript, produce a structured ` +
  `summary with these exact sections:\n\n` +
  `## Goal\nWhat the user is trying to accomplish.\n\n` +
  `## Constraints\nKey constraints, requirements, or decisions already locked in.\n\n` +
  `## Progress\nWhat has been done so far, what's working.\n\n` +
  `## Key Decisions\nImportant decisions made and their rationale.\n\n` +
  `## Next Steps\nWhat's planned or pending.\n\n` +
  `## Critical Context\nAny crucial details that would be lost in a brief summary.\n\n` +
  `Be concise but preserve specifics (names, paths, version numbers, exact ` +
  `configurations). Do not add filler or restate the obvious.`;

interface SummarizeOptions {
  readonly summaryModel?: string;
  readonly signal?: AbortSignal;
}

/**
 * Call an LLM to produce a structured summary of a transcript.
 * Uses the configured smart-compact summary model, falling back to a default.
 * Returns the summary text, or null if the LLM call fails.
 */
export async function summarizeTranscript(
  transcript: readonly TranscriptMessage[],
  options: SummarizeOptions = {},
): Promise<string | null> {
  const serialized = serializeTranscript(transcript);
  if (!serialized.trim()) return null;

  const modelString = options.summaryModel ?? "openai:gpt-4o-mini";
  const { providerId, modelId } = parseProviderAndModel(modelString);
  const config = resolveProviderConfig(providerId);
  if (!config) return null;

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) return null;

  const endpoint = providerId === "anthropic"
    ? `${config.apiBase}/messages`
    : `${config.apiBase}/chat/completions`;

  const body = providerId === "anthropic"
    ? {
        model: modelId,
        max_tokens: 2048,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Transcript:\n\n${serialized}` }],
      }
    : {
        model: modelId,
        max_tokens: 2048,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: `Transcript:\n\n${serialized}` },
        ],
      };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (providerId === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;

    // Anthropic format
    if (providerId === "anthropic") {
      const content = data.content as Array<{ type: string; text: string }> | undefined;
      return content?.[0]?.text ?? null;
    }

    // OpenAI-compatible format
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    return choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed text composition
// ---------------------------------------------------------------------------

function composeSeedText(
  framing: string,
  summary: string | null,
  quotedText?: string,
  userNote?: string,
): string {
  const parts: string[] = [framing];

  if (summary) {
    parts.push(`\n## Conversation Context\n\n${summary}`);
  }

  if (quotedText) {
    parts.push(`\n## Quoted Excerpt\n\n${quotedText}`);
  }

  if (userNote) {
    parts.push(`\n## User's Request\n\n${userNote}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Build handoff payload (pure shaping, no I/O beyond optional summarization)
// ---------------------------------------------------------------------------

/**
 * Build a handoff payload from a transcript and input parameters.
 *
 * The `transcript` must already be loaded. The `getSummary` callback is
 * invoked for compressed/selection scopes to produce the summary text.
 * This indirection lets callers control whether summarization happens
 * synchronously (cached) or via LLM (async).
 */
export async function buildHandoffPayload(
  transcript: readonly TranscriptMessage[],
  input: BuildHandoffPayloadInput,
  getSummary?: (transcript: readonly TranscriptMessage[]) => Promise<string | null>,
): Promise<HandoffPayload> {
  const { scope, quotedText, userNote, framing } = input;
  const effectiveFraming = framing ?? ADVISOR_FRAMING;

  let seedText: string;

  switch (scope) {
    case "full": {
      const serialized = serializeTranscript(transcript);
      seedText = composeSeedText(effectiveFraming, null, undefined, userNote);
      if (serialized) {
        seedText += `\n\n## Full Transcript\n\n${serialized}`;
      }
      break;
    }

    case "plan": {
      // Plan scope: include the full transcript text but don't over-compress.
      // The "plan" is whatever the conversation produced — preserve it.
      const serialized = serializeTranscript(transcript);
      seedText = composeSeedText(effectiveFraming, null, undefined, userNote);
      if (serialized) {
        seedText += `\n\n## Full Context\n\n${serialized}`;
      }
      break;
    }

    case "compressed": {
      const summary = getSummary ? await getSummary(transcript) : null;
      seedText = composeSeedText(effectiveFraming, summary, undefined, userNote);
      break;
    }

    case "selection": {
      const summary = getSummary ? await getSummary(transcript) : null;
      seedText = composeSeedText(effectiveFraming, summary, quotedText, userNote);
      break;
    }
  }

  return {
    seedText,
    scope,
    tokenEstimate: estimateTokens(seedText),
  };
}

// ---------------------------------------------------------------------------
// Build advisor-specific payload (convenience wrapper)
// ---------------------------------------------------------------------------

export function buildAdvisorPayload(
  transcript: readonly TranscriptMessage[],
  scope: HandoffScope,
  getSummary?: (transcript: readonly TranscriptMessage[]) => Promise<string | null>,
): Promise<HandoffPayload> {
  return buildHandoffPayload(
    transcript,
    {
      sessionRef: { workspaceId: "", sessionId: "" },
      scope,
      framing: ADVISOR_FRAMING,
    },
    getSummary,
  );
}

// ---------------------------------------------------------------------------
// Build questionnaire advisor payload
// ---------------------------------------------------------------------------

export function buildQuestionnaireAdvisorPayload(
  transcript: readonly TranscriptMessage[],
  questionPrompt: string,
  questionOptions: readonly string[],
  getSummary?: (transcript: readonly TranscriptMessage[]) => Promise<string | null>,
): Promise<HandoffPayload> {
  const optionsText = questionOptions.map((o, i) => `${i + 1}. ${o}`).join("\n");
  const note =
    `The user is answering a questionnaire and is unsure about the following question:\n\n` +
    `**Question:** ${questionPrompt}\n\n` +
    `**Options:**\n${optionsText}\n\n` +
    `Please analyze each option's tradeoffs in the context of the conversation and recommend the best choice.`;

  return buildHandoffPayload(
    transcript,
    {
      sessionRef: { workspaceId: "", sessionId: "" },
      scope: "compressed",
      userNote: note,
      framing: QUESTIONNAIRE_ADVISOR_FRAMING,
    },
    getSummary,
  );
}
