import { execFile } from "node:child_process";

export interface CommitPushResult {
  readonly success: boolean;
  readonly message: string;
  readonly commitMessage?: string;
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

interface ProviderConfig {
  apiBase: string;
  apiKeyEnv: string;
  modelPrefix?: string;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "openai-codex": {
    apiBase: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  "openai": {
    apiBase: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    apiBase: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  deepseek: {
    apiBase: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  groq: {
    apiBase: "https://api.groq.com/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
  "google-genai": {
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GOOGLE_API_KEY",
  },
};

function resolveProviderConfig(providerId: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[providerId];
}

async function generateCommitMessage(
  diff: string,
  providerId: string,
  modelId: string,
): Promise<string> {
  const config = resolveProviderConfig(providerId);
  if (!config) {
    throw new Error(`No API config for provider: ${providerId}`);
  }

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${config.apiKeyEnv} not set in environment.`);
  }

  const truncatedDiff = diff.length > 15000 ? diff.slice(0, 15000) + "\n... (truncated)" : diff;

  // OpenAI-compatible endpoint (works for OpenAI, DeepSeek, Groq, and many others)
  const response = await fetch(`${config.apiBase}/chat/completions`, {
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
      max_tokens: 100,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from API");
  }

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

function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "", code: 0 });
        return;
      }
      const errnoCode = (error as NodeJS.ErrnoException).code;
      if (errnoCode === "ENOENT") {
        resolve({ stdout: "", stderr: "git not found", code: 127 });
        return;
      }
      // git exits with non-zero for normal operations (e.g., diff --no-index)
      const exitCode = typeof (error as any).code === "number" ? (error as any).code as number : 1;
      resolve({ stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "", code: exitCode });
    });
  });
}

function parseProviderAndModel(modelString: string): { providerId: string; modelId: string } {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    return { providerId: "openai-codex", modelId: modelString };
  }
  return {
    providerId: modelString.slice(0, colonIndex),
    modelId: modelString.slice(colonIndex + 1),
  };
}

export async function executeCommitPush(
  workspacePath: string,
  modelString: string,
): Promise<CommitPushResult> {
  // 1. Check git repo
  const { code: repoCode } = await execGit(["rev-parse", "--git-dir"], workspacePath);
  if (repoCode !== 0) {
    return { success: false, message: "Not a git repository." };
  }

  // 2. Check for changes
  const { stdout: status, code: statusCode } = await execGit(["status", "--porcelain"], workspacePath);
  if (statusCode !== 0) {
    return { success: false, message: "Failed to check git status." };
  }

  if (!status.trim()) {
    return { success: false, message: "Nothing to commit. Working tree clean." };
  }

  // 3. Stage all changes
  const { code: addCode } = await execGit(["add", "-A"], workspacePath);
  if (addCode !== 0) {
    return { success: false, message: "Failed to stage changes." };
  }

  // 4. Get the diff for LLM
  const { stdout: diff, code: diffCode } = await execGit(["diff", "--staged"], workspacePath);
  if (diffCode !== 0) {
    return { success: false, message: "Failed to get staged diff." };
  }

  if (!diff.trim()) {
    return { success: false, message: "No staged changes to commit." };
  }

  // 5. Generate commit message via LLM
  const { providerId, modelId } = parseProviderAndModel(modelString);
  let commitMessage: string;
  try {
    commitMessage = await generateCommitMessage(diff, providerId, modelId);
  } catch (err) {
    // Unstage so user can try again
    await execGit(["reset", "HEAD"], workspacePath);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Commit message generation failed: ${errorMessage}` };
  }

  // 6. Commit
  const { stderr: commitStderr, code: commitCode } = await execGit(
    ["commit", "-m", commitMessage],
    workspacePath,
  );
  if (commitCode !== 0) {
    return { success: false, message: `Commit failed: ${commitStderr}` };
  }

  // 7. Push
  const { stdout: pushOut, stderr: pushErr, code: pushCode } = await execGit(
    ["push"],
    workspacePath,
  );

  if (pushCode === 0) {
    return {
      success: true,
      message: `Committed and pushed: "${commitMessage}"`,
      commitMessage,
    };
  }

  const pushOutput = pushErr || pushOut || "Unknown error";
  return {
    success: false,
    message: `Committed (${commitMessage}) but push failed: ${pushOutput.slice(0, 200)}`,
    commitMessage,
  };
}
