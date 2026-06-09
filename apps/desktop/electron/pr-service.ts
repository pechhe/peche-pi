import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execGh, execGit, isGitRepo } from "./git-runner";
import { PROVIDER_CONFIGS, parseProviderAndModel } from "./llm-helpers";

export type PrState = "none" | "open" | "closed" | "merged";

export interface PrInfo {
  readonly ghAvailable: boolean;
  readonly isGitRepo: boolean;
  readonly hasUpstream: boolean;
  readonly headBranch: string;
  readonly defaultBranch: string;
  readonly prState: PrState;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly baseBranch?: string;
}

export interface PrDraftSuggestion {
  readonly success: boolean;
  readonly title: string;
  readonly body: string;
  readonly message?: string;
}

export interface CreatePrInput {
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly draft: boolean;
}

export interface CreatePrResult {
  readonly success: boolean;
  readonly message: string;
  readonly url?: string;
  readonly number?: number;
}

let logFilePath: string | undefined;

export function configurePrLogDir(dir: string): void {
  logFilePath = path.join(dir, "pr-service.log");
}

function log(step: string, payload: Record<string, unknown> = {}): void {
  const entry = { tag: "pr-service", step, ts: new Date().toISOString(), ...payload };
  const line = JSON.stringify(entry);
  console.error(line);
  if (logFilePath) {
    const target = logFilePath;
    void mkdir(path.dirname(target), { recursive: true })
      .then(() => appendFile(target, line + "\n"))
      .catch(() => {});
  }
}

function logError(step: string, err: unknown, payload: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log(step, { ...payload, error: message, stack });
}


async function ghAvailable(cwd: string): Promise<boolean> {
  const { code } = await execGh(["--version"], cwd);
  return code === 0;
}

async function getHeadBranch(cwd: string): Promise<string> {
  const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return stdout;
}

async function hasUpstream(cwd: string): Promise<boolean> {
  const { code } = await execGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    cwd,
  );
  return code === 0;
}

async function getDefaultBranch(cwd: string): Promise<string> {
  // Prefer gh's view of the repo default; fall back to origin/HEAD; fall back to "main".
  const ghResult = await execGh(
    ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
    cwd,
  );
  if (ghResult.code === 0 && ghResult.stdout) {
    return ghResult.stdout;
  }
  const headRef = await execGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd);
  if (headRef.code === 0 && headRef.stdout) {
    // Returns e.g. "origin/main"
    const parts = headRef.stdout.split("/");
    return parts[parts.length - 1] || "main";
  }
  return "main";
}

interface GhPrViewJson {
  number?: number;
  url?: string;
  state?: string;
  baseRefName?: string;
  isDraft?: boolean;
}

async function getPrForCurrentBranch(cwd: string): Promise<GhPrViewJson | undefined> {
  const { stdout, code } = await execGh(
    ["pr", "view", "--json", "number,url,state,baseRefName,isDraft"],
    cwd,
  );
  if (code !== 0) return undefined;
  try {
    return JSON.parse(stdout) as GhPrViewJson;
  } catch {
    return undefined;
  }
}

function ghStateToPrState(state: string | undefined): PrState {
  switch ((state ?? "").toUpperCase()) {
    case "OPEN":
      return "open";
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return "none";
  }
}

export async function getWorkspacePrInfo(workspacePath: string): Promise<PrInfo> {
  if (!(await isGitRepo(workspacePath))) {
    return {
      ghAvailable: false,
      isGitRepo: false,
      hasUpstream: false,
      headBranch: "",
      defaultBranch: "",
      prState: "none",
    };
  }

  const headBranch = await getHeadBranch(workspacePath);
  const upstream = await hasUpstream(workspacePath);
  const gh = await ghAvailable(workspacePath);

  if (!gh) {
    return {
      ghAvailable: false,
      isGitRepo: true,
      hasUpstream: upstream,
      headBranch,
      defaultBranch: "",
      prState: "none",
    };
  }

  const defaultBranch = await getDefaultBranch(workspacePath);
  const pr = upstream ? await getPrForCurrentBranch(workspacePath) : undefined;

  return {
    ghAvailable: true,
    isGitRepo: true,
    hasUpstream: upstream,
    headBranch,
    defaultBranch,
    prState: ghStateToPrState(pr?.state),
    prUrl: pr?.url,
    prNumber: pr?.number,
    baseBranch: pr?.baseRefName,
  };
}

// ---------------------------------------------------------------------------
// PR body generation
// ---------------------------------------------------------------------------

const PR_SYSTEM_PROMPT = [
  "You are a pull request description generator.",
  "Produce a concise PR title and a markdown body for the provided git log + diff.",
  "Output JSON with exactly two keys: title (string), body (string).",
  "Title rules:",
  "- Imperative mood, present tense.",
  "- Under 72 characters.",
  "- No trailing period.",
  "Body rules:",
  "- Use three markdown sections, in this exact order, each as an H2:",
  "  ## Summary",
  "  ## Changes",
  "  ## Test plan",
  "- Summary: 1-3 sentences of context and motivation.",
  "- Changes: bullet list of concrete changes (file or area level).",
  "- Test plan: bullet list of verifications. If unknown, write '- [ ] Manually verify in dev app'.",
  "- No preamble, no explanation, no code fences around the JSON itself.",
  "- The JSON must be parseable. Body is a single JSON string with \\n line breaks.",
].join("\n");


function fallbackDraft(headBranch: string, commits: string): { title: string; body: string } {
  const firstSubject = commits.split("\n").find((line) => line.trim())?.replace(/^\w+\s+/, "") ?? headBranch;
  const title = firstSubject.slice(0, 72) || headBranch || "Update";
  const body = [
    "## Summary",
    "",
    "_Describe the motivation for this change._",
    "",
    "## Changes",
    "",
    commits
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `- ${l.replace(/^\w+\s+/, "")}`)
      .join("\n") || "- _List concrete changes here._",
    "",
    "## Test plan",
    "",
    "- [ ] Manually verify in dev app",
    "",
  ].join("\n");
  return { title, body };
}

async function getPrInputs(
  cwd: string,
  baseBranch: string,
): Promise<{ commits: string; diff: string }> {
  // Use the merge-base so we describe what this branch contributes.
  const mergeBase = await execGit(["merge-base", "HEAD", `origin/${baseBranch}`], cwd);
  const baseRef = mergeBase.code === 0 && mergeBase.stdout ? mergeBase.stdout : `origin/${baseBranch}`;

  const commitsResult = await execGit(
    ["log", `${baseRef}..HEAD`, "--pretty=format:%h %s"],
    cwd,
  );
  const diffResult = await execGit(["diff", `${baseRef}..HEAD`], cwd);

  return {
    commits: commitsResult.code === 0 ? commitsResult.stdout : "",
    diff: diffResult.code === 0 ? diffResult.stdout : "",
  };
}

function extractJsonObject(raw: string): string | undefined {
  // Strip code fences if present.
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return undefined;
  return s.slice(first, last + 1);
}

export async function generatePrDraft(
  workspacePath: string,
  modelString: string,
  baseBranchHint: string | undefined,
  getApiKey: (providerId: string) => Promise<string | undefined>,
): Promise<PrDraftSuggestion> {
  const started = Date.now();
  if (!(await isGitRepo(workspacePath))) {
    return { success: false, title: "", body: "", message: "Not a git repository." };
  }

  const headBranch = await getHeadBranch(workspacePath);
  const base = baseBranchHint || (await getDefaultBranch(workspacePath));

  const { commits, diff } = await getPrInputs(workspacePath, base);

  if (!commits.trim() && !diff.trim()) {
    const draft = fallbackDraft(headBranch, "");
    return { success: true, ...draft, message: "No commits ahead of base; using empty template." };
  }

  const { providerId, modelId } = parseProviderAndModel(modelString);
  const config = PROVIDER_CONFIGS[providerId];
  if (!config) {
    log("llm.unsupported_provider", { providerId });
    const draft = fallbackDraft(headBranch, commits);
    return {
      success: true,
      ...draft,
      message: `Provider "${providerId}" not wired for PR body generation. Using fallback.`,
    };
  }

  const apiKey = (await getApiKey(providerId)) ?? process.env[config.apiKeyEnv];
  if (!apiKey) {
    log("llm.missing_key", { providerId, env: config.apiKeyEnv });
    const draft = fallbackDraft(headBranch, commits);
    return {
      success: true,
      ...draft,
      message: `${config.apiKeyEnv} not set. Add your key in Settings → Providers, or use a fallback template.`,
    };
  }

  const truncatedDiff = diff.length > 20000 ? diff.slice(0, 20000) + "\n... (truncated)" : diff;
  const userMessage = [
    `Head branch: ${headBranch}`,
    `Base branch: ${base}`,
    "",
    "Commits on this branch (ahead of base):",
    commits || "(none)",
    "",
    "Combined diff:",
    truncatedDiff || "(no diff)",
  ].join("\n");

  log("llm.request", {
    providerId,
    modelId,
    commitsBytes: commits.length,
    diffBytes: diff.length,
    truncated: diff.length > 20000,
  });

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
          { role: "system", content: PR_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    logError("llm.network", err, { providerId, modelId });
    const draft = fallbackDraft(headBranch, commits);
    return { success: true, ...draft, message: `Network error reaching LLM; using fallback.` };
  }

  if (!response.ok) {
    const body = await response.text();
    log("llm.http_error", { providerId, modelId, status: response.status, body: body.slice(0, 500) });
    const draft = fallbackDraft(headBranch, commits);
    return {
      success: true,
      ...draft,
      message: `LLM HTTP ${response.status}; using fallback template.`,
    };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  const finishReason = data.choices?.[0]?.finish_reason;

  if (!content) {
    log("llm.empty_response", { providerId, modelId, finishReason });
    const draft = fallbackDraft(headBranch, commits);
    return { success: true, ...draft, message: "LLM returned empty content; using fallback." };
  }

  const jsonStr = extractJsonObject(content);
  if (!jsonStr) {
    log("llm.no_json", { providerId, modelId, rawContent: content.slice(0, 200) });
    const draft = fallbackDraft(headBranch, commits);
    return { success: true, ...draft, message: "LLM output was not JSON; using fallback." };
  }

  try {
    const parsed = JSON.parse(jsonStr) as { title?: string; body?: string };
    const title = (parsed.title ?? "").trim();
    const body = (parsed.body ?? "").trim();
    if (!title || !body) {
      const draft = fallbackDraft(headBranch, commits);
      return { success: true, ...draft, message: "LLM JSON missing fields; using fallback." };
    }
    log("llm.ok", { providerId, modelId, durationMs: Date.now() - started });
    return { success: true, title: title.slice(0, 200), body };
  } catch (err) {
    logError("llm.json_parse", err, { providerId, modelId });
    const draft = fallbackDraft(headBranch, commits);
    return { success: true, ...draft, message: "LLM JSON parse failed; using fallback." };
  }
}

// ---------------------------------------------------------------------------
// Create PR
// ---------------------------------------------------------------------------

export async function createPullRequest(
  workspacePath: string,
  input: CreatePrInput,
): Promise<CreatePrResult> {
  log("create.start", { base: input.base, draft: input.draft, titleLen: input.title.length });

  if (!(await isGitRepo(workspacePath))) {
    return { success: false, message: "Not a git repository." };
  }
  if (!(await ghAvailable(workspacePath))) {
    return { success: false, message: "GitHub CLI (gh) not found on PATH." };
  }

  if (!input.title.trim()) {
    return { success: false, message: "Title is required." };
  }
  if (!input.base.trim()) {
    return { success: false, message: "Base branch is required." };
  }

  // gh requires upstream to exist. If the branch was just committed locally
  // and never pushed, push first.
  if (!(await hasUpstream(workspacePath))) {
    const head = await getHeadBranch(workspacePath);
    const push = await execGit(["push", "-u", "origin", head], workspacePath);
    if (push.code !== 0) {
      log("create.push_failed", { stderr: push.stderr });
      return {
        success: false,
        message: `git push -u origin ${head} failed: ${(push.stderr || push.stdout).slice(0, 300)}`,
      };
    }
  }

  const args = [
    "pr",
    "create",
    "--base",
    input.base,
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  if (input.draft) args.push("--draft");

  const result = await execGh(args, workspacePath);
  if (result.code !== 0) {
    log("create.failed", { code: result.code, stderr: result.stderr, stdout: result.stdout });
    return {
      success: false,
      message: `gh pr create failed: ${(result.stderr || result.stdout).slice(0, 400)}`,
    };
  }

  // gh prints the PR URL on the last line of stdout on success.
  const url = result.stdout.split("\n").map((l) => l.trim()).reverse().find((l) => l.startsWith("http"));
  const numberMatch = url?.match(/\/pull\/(\d+)/);
  log("create.ok", { url, number: numberMatch?.[1] });
  return {
    success: true,
    message: `Pull request created: ${url ?? "(url unknown)"}`,
    url,
    number: numberMatch ? Number(numberMatch[1]) : undefined,
  };
}
