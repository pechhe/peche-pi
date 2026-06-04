import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execGit } from "./git-runner";
import {
  PROVIDER_CONFIGS,
  parseProviderAndModel,
  resolveProviderConfig,
} from "./llm-helpers";

export interface CommitPushResult {
  readonly success: boolean;
  readonly message: string;
  readonly commitMessage?: string;
}

// Module-scoped log destination. Set once by main.ts via configureCommitPushLogDir.
let logFilePath: string | undefined;

export function configureCommitPushLogDir(dir: string): void {
  logFilePath = path.join(dir, "commit-push.log");
}

function log(step: string, payload: Record<string, unknown> = {}): void {
  const entry = { tag: "commit-push", step, ts: new Date().toISOString(), ...payload };
  const line = JSON.stringify(entry);
  // Always emit to stderr for terminal-launched Pi Dev.
  console.error(line);
  // Best-effort append to a log file so launches from Finder are diagnosable.
  if (logFilePath) {
    const target = logFilePath;
    void mkdir(path.dirname(target), { recursive: true })
      .then(() => appendFile(target, line + "\n"))
      .catch(() => {
        // Logging must never throw into the caller.
      });
  }
}

function logError(step: string, err: unknown, payload: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log(step, { ...payload, error: message, stack });
}

const COMMIT_SYSTEM_PROMPT = [
  "You are a commit message generator.",
  "Produce a single conventional commit message line for the provided git diff.",
  "Follow the format: type(scope): description",
  "Types: feat, fix, refactor, chore, docs, style, test, perf, ci, build.",
  "Rules:",
  "- Use present tense, imperative mood ('add' not 'added').",
  "- Keep the first line under 72 characters.",
  "- If the diff is large or multi-topic, prefer a broad accurate scope.",
  "- Output ONLY the commit message. No quotes, no markdown, no explanation.",
  "- Do not wrap in backticks or code fences.",
].join("\n");

async function generateCommitMessage(
  diff: string,
  providerId: string,
  modelId: string,
  getApiKey: (providerId: string) => Promise<string | undefined>,
): Promise<string> {
  const config = resolveProviderConfig(providerId);
  if (!config) {
    const supported = Object.keys(PROVIDER_CONFIGS).join(", ");
    throw new Error(
      `Provider "${providerId}" is not wired for commit-message generation. Supported: ${supported}. Pick another model with the gear icon.`,
    );
  }

  const apiKey = (await getApiKey(providerId)) ?? process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `${config.apiKeyEnv} not set. Add your API key in Settings → Providers, or set it in your environment before opening Pi Dev.`,
    );
  }

  const truncatedDiff = diff.length > 15000 ? diff.slice(0, 15000) + "\n... (truncated)" : diff;
  log("llm.request", { providerId, modelId, diffBytes: diff.length, truncated: diff.length > 15000 });

  // OpenAI-compatible endpoint (works for OpenAI, DeepSeek, Groq, and many others)
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: COMMIT_SYSTEM_PROMPT },
          { role: "user", content: `Generate a commit message for this diff:\n\n${truncatedDiff}` },
        ],
        // Reasoning models burn tokens on internal reasoning before emitting
        // visible content. 512 leaves headroom while still capping cost.
        max_tokens: 512,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    logError("llm.network", err, { providerId, modelId, apiBase: config.apiBase });
    throw new Error(`Network error reaching ${config.apiBase}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    log("llm.http_error", { providerId, modelId, status: response.status, body: body.slice(0, 500) });
    throw new Error(`API error ${response.status} from ${providerId}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason;

  if (!content) {
    log("llm.empty_response", { providerId, modelId, finishReason, data });
    // Specific case: reasoning model exhausted the token budget before
    // emitting visible content. Help the user pick a better model.
    if (finishReason === "length" && choice?.message?.reasoning_content) {
      throw new Error(
        `${providerId}/${modelId} ran out of tokens on internal reasoning (finish_reason=length). Pick a non-reasoning chat model (e.g. deepseek-chat, gpt-4o-mini) with the gear icon next to the commit button.`,
      );
    }
    throw new Error(`Empty response from ${providerId}/${modelId} (finish_reason=${finishReason ?? "unknown"})`);
  }

  log("llm.ok", { providerId, modelId, finishReason, rawContent: content.slice(0, 200) });
  return cleanCommitMessage(content);
}

function cleanCommitMessage(raw: string): string {
  let cleaned = raw
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/^```\w*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  if (!cleaned) {
    throw new Error("Generated empty commit message");
  }

  cleaned = cleaned.split("\n")[0]!.trim();
  return cleaned || "chore: update";
}



export async function executeCommitPush(
  workspacePath: string,
  modelString: string,
  getApiKey: (providerId: string) => Promise<string | undefined>,
): Promise<CommitPushResult> {
  const started = Date.now();
  log("start", { workspacePath, modelString });

  // 1. Check git repo
  const { code: repoCode, stderr: repoErr } = await execGit(["rev-parse", "--git-dir"], workspacePath);
  if (repoCode !== 0) {
    log("not_git_repo", { workspacePath, repoErr });
    return { success: false, message: "[repo] Not a git repository." };
  }

  // 2. Check for changes
  const { stdout: status, code: statusCode, stderr: statusErr } = await execGit(["status", "--porcelain"], workspacePath);
  if (statusCode !== 0) {
    log("status_failed", { workspacePath, statusErr });
    return { success: false, message: `[status] git status failed: ${statusErr}` };
  }

  if (!status.trim()) {
    log("clean", { workspacePath });
    return { success: false, message: "[status] Nothing to commit. Working tree clean." };
  }

  const changedCount = status.split("\n").filter((l) => l.trim()).length;
  log("dirty", { workspacePath, changedCount });

  // 3. Stage all changes
  const { code: addCode, stderr: addErr } = await execGit(["add", "-A"], workspacePath);
  if (addCode !== 0) {
    log("stage_failed", { workspacePath, addErr });
    return { success: false, message: `[stage] git add -A failed: ${addErr}` };
  }

  // 4. Get the diff for LLM
  const { stdout: diff, code: diffCode, stderr: diffErr } = await execGit(["diff", "--staged"], workspacePath);
  if (diffCode !== 0) {
    log("diff_failed", { workspacePath, diffErr });
    return { success: false, message: `[diff] git diff --staged failed: ${diffErr}` };
  }

  if (!diff.trim()) {
    log("no_staged_diff", { workspacePath });
    return { success: false, message: "[diff] No staged changes to commit." };
  }

  // 5. Generate commit message via LLM
  const { providerId, modelId } = parseProviderAndModel(modelString);
  let commitMessage: string;
  try {
    commitMessage = await generateCommitMessage(diff, providerId, modelId, getApiKey);
  } catch (err) {
    // Unstage so user can try again
    await execGit(["reset", "HEAD"], workspacePath);
    logError("llm_failed", err, { providerId, modelId });
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, message: `[llm] ${errorMessage}` };
  }
  log("commit_message", { commitMessage });

  // 6. Commit
  const { stderr: commitStderr, stdout: commitStdout, code: commitCode } = await execGit(
    ["commit", "-m", commitMessage],
    workspacePath,
  );
  if (commitCode !== 0) {
    log("commit_failed", { commitCode, commitStderr, commitStdout });
    return { success: false, message: `[commit] git commit failed: ${commitStderr || commitStdout}` };
  }
  log("commit_ok", { commitMessage });

  // 7. Push
  const { stdout: pushOut, stderr: pushErr, code: pushCode } = await execGit(
    ["push"],
    workspacePath,
  );

  if (pushCode === 0) {
    log("push_ok", { durationMs: Date.now() - started, pushOut, pushErr });
    return {
      success: true,
      message: `Committed and pushed: "${commitMessage}"`,
      commitMessage,
    };
  }

  const pushOutput = pushErr || pushOut || "Unknown error";
  log("push_failed", { pushCode, pushOut, pushErr });
  return {
    success: false,
    message: `[push] Committed (${commitMessage}) but git push failed: ${pushOutput.slice(0, 300)}`,
    commitMessage,
  };
}
