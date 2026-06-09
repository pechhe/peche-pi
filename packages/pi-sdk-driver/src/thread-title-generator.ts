import {
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  createAgentSession,
  type CreateAgentSessionOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { SessionModelSelection, WorkspaceRef } from "@pi-gui/session-driver";
import { messageText as sessionMessageText } from "./session-supervisor-utils.js";

export interface GeneratedThreadTitle {
  readonly type: string;
  readonly title: string;
}

export interface GenerateThreadTitleOptions {
  readonly prompt: string;
  readonly model?: SessionModelSelection;
  readonly thinkingLevel?: string;
  readonly signal?: AbortSignal;
}

interface ThreadTitleGeneratorDeps {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
}

const MAX_THREAD_TITLE_LENGTH = 36;
const THREAD_TITLE_SYSTEM_PROMPT = [
  "You generate concise UI thread titles for a coding assistant.",
  "Return your answer on two lines: the thread type, then the title.",
  "Line 1: exactly one of: bug, feature, refactor, investigate, other",
  "Line 2: the title (2 to 5 words, same language as the source message).",
  "Preserve ticket IDs exactly.",
  "No markdown, quotes, labels, or trailing punctuation.",
].join("\n");

export async function generateThreadTitle(
  workspace: WorkspaceRef,
  options: GenerateThreadTitleOptions,
  deps: ThreadTitleGeneratorDeps,
): Promise<GeneratedThreadTitle | null> {
  const prompt = options.prompt.trim();
  if (!prompt || options.signal?.aborted) {
    return null;
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = createThreadTitleResourceLoader();

  const createOptions: CreateAgentSessionOptions = {
    cwd: workspace.path,
    agentDir: deps.agentDir,
    authStorage: deps.authStorage,
    modelRegistry: deps.modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  };
  if (options.model) {
    const selectedModel = deps.modelRegistry.find(options.model.provider, options.model.modelId);
    if (!selectedModel) {
      return null;
    }
    createOptions.model = selectedModel;
  }
  if (options.thinkingLevel) {
    createOptions.thinkingLevel = options.thinkingLevel as NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;
  }

  const { session } = await createAgentSession(createOptions);
  const handleAbort = () => {
    void session.abort().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    if (options.signal?.aborted) {
      return null;
    }
    if (!session.model) {
      return null;
    }
    // Only require that auth resolves (auth.ok). Do NOT require auth.apiKey:
    // OAuth / subscription providers (Claude Pro/Max, ChatGPT) authenticate via
    // injected bearer tokens, not a stored apiKey, so apiKey is undefined there.
    // Requiring it silently skipped titles for every OAuth-backed thread.
    const auth = await session.modelRegistry.getApiKeyAndHeaders(session.model);
    if (!auth.ok) {
      return null;
    }

    await session.prompt(buildTitlePrompt(prompt), { source: "interactive" });
    return parseGeneratedThreadTitle(extractLastAssistantText(session));
  } finally {
    options.signal?.removeEventListener("abort", handleAbort);
    session.dispose();
  }
}

function createThreadTitleResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => THREAD_TITLE_SYSTEM_PROMPT,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function buildTitlePrompt(prompt: string): string {
  return [
    "Classify the user's first message and generate a short thread title.",
    "Return exactly two lines: the type, then the title.",
    "",
    "<user_message>",
    prompt,
    "</user_message>",
  ].join("\n");
}

function extractLastAssistantText(session: { messages: readonly unknown[] }): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (!isRecord(message) || message.role !== "assistant") {
      continue;
    }
    return sessionMessageText(message);
  }
  return "";
}

const VALID_THREAD_TYPES = new Set(["bug", "feature", "refactor", "investigate", "other"]);

/**
 * Parse the model's two-line response: line 1 = type, line 2 = title.
 * Falls back to "other" type if the first line isn't a valid type.
 */
function parseGeneratedThreadTitle(raw: string): GeneratedThreadTitle | null {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0]!;
  let type: string;
  let titleRaw: string;

  if (lines.length >= 2) {
    // Two-line format: type on line 1, title on line 2.
    type = firstLine.toLowerCase().replace(/[^a-z]/g, "");
    titleRaw = lines[1]!;
  } else {
    // Single line — try to extract type prefix "type: title".
    const colonMatch = firstLine.match(/^(bug|feature|refactor|investigate|other)\s*:\s*(.+)$/i);
    if (colonMatch) {
      type = (colonMatch[1] ?? "other").toLowerCase();
      titleRaw = colonMatch[2] ?? firstLine;
    } else {
      type = "other";
      titleRaw = firstLine;
    }
  }

  if (!VALID_THREAD_TYPES.has(type)) {
    type = "other";
  }

  const title = normalizeTitle(titleRaw);
  if (!title) {
    return null;
  }
  return { type, title };
}

function normalizeTitle(title: string): string | null {
  let normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/^title\s*:\s*/i, "").trim();
  normalized = stripWrappingQuotes(normalized);
  normalized = normalized.replace(/[.?!,:;]+$/g, "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_THREAD_TITLE_LENGTH) {
    normalized = `${normalized.slice(0, MAX_THREAD_TITLE_LENGTH - 3).trimEnd()}...`;
  }

  return normalized || null;
}

function stripWrappingQuotes(value: string): string {
  let current = value.trim();
  while (current.length >= 2) {
    const first = current[0];
    const last = current[current.length - 1];
    if (
      (first === "\"" && last === "\"") ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`")
    ) {
      current = current.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
