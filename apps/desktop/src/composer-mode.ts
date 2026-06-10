export type ComposerMode = "build" | "plan";
export type PlanModeIdeology = "default" | "grill";

const PLAN_MODE_FULL_INSTRUCTIONS = `Run this as pi-gui Plan mode: read-only exploration first, implementation later only after user approval.

Plan mode mechanics:
- You are currently restricted to read-only tools: read, grep, find, ls, and questionnaire.
- Do not edit files, write files, install packages, change git state, launch destructive commands, or start implementation.
- If repository inspection can answer a question, inspect before asking.
- Ask clarifying questions through the questionnaire tool when choices are clear. Use stable ids, 2-6 concise options, one recommended default when appropriate, and allowOther when free text may matter.
- When enough is known, produce a numbered plan under an exact "Plan:" header.
- Include validation steps and risks in the plan.
- End by asking whether to execute, refine, or stop.`;

const PLAN_MODE_SLIM_REMINDER = `Plan mode active. Read-only: do not edit files, write files, install packages, or run non-readonly tools. Continue gathering context and asking clarifying questions until requirements are clear, then write the plan.`;

const DEFAULT_PLAN_IDEOLOGY = `Planning ideology: default product/engineering plan.

Behavior:
- Minimize scope before optimizing.
- Prefer concrete implementation slices over broad strategy.
- Surface assumptions, tradeoffs, dependencies, and verification.
- Ask only questions that materially change the plan.`;

const GRILL_PLAN_IDEOLOGY = `Planning ideology: grill-with-docs.

Behavior:
- Interview the user relentlessly until the design is resolved.
- Ask one focused question at a time unless several questions are tightly coupled.
- Challenge assumptions, terminology, and scope; do not accept vague language.
- If project docs or code define the domain language, use them as source of truth.
- Capture decisions, open questions, and rejected alternatives.
- When the grill naturally concludes, produce a decision log and a Ralph-loop-compatible task plan.
- Mention any docs/ADR updates that should happen during the write-enabled execution phase; do not edit them during read-only planning.`;

const PLAN_IDEOLOGY_PROMPTS: Record<PlanModeIdeology, string> = {
  default: DEFAULT_PLAN_IDEOLOGY,
  grill: GRILL_PLAN_IDEOLOGY,
};

export const PLAN_MODE_PROMPT_SEPARATOR = "<!--pi-plan-mode-prompt-->";

/**
 * Build a plan-mode prompt.
 * @param isFirst If true (default), includes the full plan-mode instructions.
 *   If false, uses a slim reminder — the harness already enforces read-only
 *   via tool restrictions, so we only need to steer behavior, not restate rules.
 */
export function buildPlanModePrompt(
  userPrompt: string,
  ideology: PlanModeIdeology = "default",
  isFirst: boolean = true,
): string {
  const trimmed = userPrompt.trim();
  const instructions = isFirst ? PLAN_MODE_FULL_INSTRUCTIONS : PLAN_MODE_SLIM_REMINDER;
  return [
    instructions,
    PLAN_IDEOLOGY_PROMPTS[ideology],
    PLAN_MODE_PROMPT_SEPARATOR,
    "User planning request:",
    trimmed,
  ].join("\n\n");
}

/** Substitute every `{{input}}` token in a sticky wrap template with the raw text. */
export function applyWrapTemplate(rawText: string, template: string): string {
  return template.split("{{input}}").join(rawText);
}

/**
 * Compose the outgoing prompt from the raw composer text, applying an optional
 * sticky wrap *inside* plan mode so plan mode stays the outer, authoritative
 * frame: `planModePrompt(userWrap(rawText))`.
 */
export function composeOutgoingPrompt(
  rawText: string,
  options: {
    readonly mode: ComposerMode;
    readonly ideology?: PlanModeIdeology;
    readonly isFirst?: boolean;
    readonly wrapTemplate?: string | null;
  },
): string {
  const wrapped = options.wrapTemplate ? applyWrapTemplate(rawText, options.wrapTemplate) : rawText;
  return options.mode === "plan"
    ? buildPlanModePrompt(wrapped, options.ideology, options.isFirst)
    : wrapped;
}
