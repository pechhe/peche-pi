/**
 * Composer Layout Builder — main-process LLM completion module.
 *
 * Issues one-shot chat completions against the user's configured model,
 * constrained to produce a single Chassis Action candidate.  The candidate
 * is schema-validated before returning; invalid output is retried once with
 * the validation error fed back to the model.
 *
 * Reuses the same OpenAI-compatible fetch pattern as commit-push-service.ts.
 * NO pi session, NO workspace/cwd, NO agent tools, NO session-list entry.
 */

import {
  type ChassisActionCandidate,
  validateChassisActionCandidate,
} from "../src/chassis.ts";
import {
  parseProviderAndModel,
  resolveProviderConfig,
  PROVIDER_CONFIGS,
} from "./llm-helpers.ts";

// ── Public types ──────────────────────────────────────────────────────────

export type { ChassisActionCandidate } from "../src/chassis.ts";

export interface BuilderChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface BuilderCommand {
  readonly label: string;
  readonly command: string;
}

export interface BuildChassisActionCandidateInput {
  readonly messages: readonly BuilderChatMessage[];
  readonly availableCommands?: readonly BuilderCommand[];
  readonly modelString?: string;
}

export interface BuildChassisActionCandidateResult {
  readonly assistantMessage: string;
  readonly candidate: ChassisActionCandidate | null;
  readonly validationError?: string;
}

// ── System prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(commands: readonly BuilderCommand[]): string {
  const commandSection =
    commands.length > 0
      ? [
          "Available slash commands the user may have installed:",
          ...commands.map((c) => `  ${c.command} — ${c.label}`),
          "",
          "When the user asks for a one-shot button that sends a command, use the exact slash command above as the effect text.",
        ].join("\n")
      : "No slash commands are currently available. Ask the user what text or template the action should use.";

  return [
    "You are a Composer Layout Builder assistant. You help users create Chassis Actions for their composer.",
    "",
    "A Chassis Action is one of three kinds:",
    '1. oneShot + submit — a button that sends a fixed text (e.g. a slash command like "/review") when clicked.',
    '2. sticky + wrap — a toggle that, when active, wraps every outgoing prompt with a template. The template MUST contain the literal token {{input}} where the user\'s prompt is inserted.',
    "3. sticky + reminder — a toggle that, when active, injects a reminder message at the start of every session.",
    "",
    "When the user describes what they want, propose a SINGLE Chassis Action candidate.",
    "Output the candidate as a JSON code block with exactly these fields:",
    '  { "label": string, "showLabel": boolean, "trigger": "oneShot"|"sticky", "effect": { ... } }',
    "",
    "Effect shapes:",
    '  oneShot → { "type": "submit", "text": "<the text to send>" }',
    '  sticky/wrap → { "type": "wrap", "template": "<template with {{input}}>" }',
    '  sticky/reminder → { "type": "reminder", "text": "<reminder text>" }',
    "",
    "Rules:",
    "- Propose ONE candidate at a time.",
    "- Ask clarifying questions if the user's intent is ambiguous.",
    "- Keep labels short (1-3 words).",
    "- showLabel defaults to true unless the user says otherwise.",
    "- After proposing a candidate, briefly explain what it does.",
    "- Only output the JSON code block when you have enough information to propose a concrete action.",
    "",
    commandSection,
  ].join("\n");
}

// ── Candidate extraction ──────────────────────────────────────────────────

const CANDIDATE_JSON_RE = /```(?:json)?\s*\n(\{[\s\S]*?\})\s*\n```/;

export function extractCandidateJson(text: string): unknown | null {
  const match = CANDIDATE_JSON_RE.exec(text);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── LLM call ──────────────────────────────────────────────────────────────

interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

async function callChatCompletion(
  messages: readonly ChatMessage[],
  providerId: string,
  modelId: string,
  getApiKey: (providerId: string) => Promise<string | undefined>,
): Promise<string> {
  const config = resolveProviderConfig(providerId);
  if (!config) {
    const supported = Object.keys(PROVIDER_CONFIGS).join(", ");
    throw new Error(
      `Provider "${providerId}" is not supported. Supported: ${supported}.`,
    );
  }

  const apiKey = (await getApiKey(providerId)) ?? process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `${config.apiKeyEnv} not set. Add your API key in Settings → Providers.`,
    );
  }

  const response = await fetch(`${config.apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: 1024,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `API error ${response.status} from ${providerId}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const finishReason = choice?.finish_reason ?? "unknown";
    throw new Error(
      `Empty response from ${providerId}/${modelId} (finish_reason=${finishReason})`,
    );
  }

  return content;
}

// ── Public entry point ────────────────────────────────────────────────────

const MAX_RETRIES = 1;

/**
 * Build a Chassis Action candidate via LLM completion.
 *
 * Each call issues one (or two, on validation failure) chat completion(s)
 * against the user's configured model.  The full messages[] history is
 * forwarded so multi-turn conversation works naturally from the renderer.
 */
export async function buildChassisActionCandidate(
  input: BuildChassisActionCandidateInput,
  getApiKey: (providerId: string) => Promise<string | undefined>,
): Promise<BuildChassisActionCandidateResult> {
  const modelString = input.modelString ?? "deepseek:deepseek-chat";
  const { providerId, modelId } = parseProviderAndModel(modelString);

  const systemPrompt = buildSystemPrompt(input.availableCommands ?? []);

  // Build the messages array for the API call
  const apiMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let assistantMessage: string;
  try {
    assistantMessage = await callChatCompletion(
      apiMessages,
      providerId,
      modelId,
      getApiKey,
    );
  } catch (err) {
    throw err;
  }

  // Try to extract and validate a candidate from the response
  const raw = extractCandidateJson(assistantMessage);
  if (raw === null) {
    // Model responded with text only — no candidate proposed yet
    return { assistantMessage, candidate: null };
  }

  const validation = validateChassisActionCandidate(raw);
  if (validation.valid) {
    return { assistantMessage, candidate: validation.action };
  }

  // Validation failed — retry once with the error fed back
  const retryMessages: ChatMessage[] = [
    ...apiMessages,
    { role: "assistant", content: assistantMessage },
    {
      role: "user",
      content: `The candidate you proposed is invalid: ${validation.error}\n\nPlease fix it and propose a corrected candidate.`,
    },
  ];

  let retryMessage: string;
  try {
    retryMessage = await callChatCompletion(
      retryMessages,
      providerId,
      modelId,
      getApiKey,
    );
  } catch {
    // If retry fails, return the original with the validation error
    return {
      assistantMessage,
      candidate: null,
      validationError: validation.error,
    };
  }

  const retryRaw = extractCandidateJson(retryMessage);
  if (retryRaw === null) {
    return {
      assistantMessage: retryMessage,
      candidate: null,
      validationError: validation.error,
    };
  }

  const retryValidation = validateChassisActionCandidate(retryRaw);
  if (retryValidation.valid) {
    return { assistantMessage: retryMessage, candidate: retryValidation.action };
  }

  // Still invalid after retry — return error, never persist
  return {
    assistantMessage: retryMessage,
    candidate: null,
    validationError: retryValidation.error,
  };
}
