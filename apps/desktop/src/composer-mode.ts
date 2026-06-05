export type ComposerMode = "build" | "plan";
export type PlanModeIdeology = "default" | "grill";

const PLAN_MODE_INSTRUCTIONS = `Run this as pi-gui Plan mode: read-only exploration first, implementation later only after user approval.

Plan mode mechanics:
- You are currently restricted to read-only tools: read, grep, find, ls, and questionnaire.
- Do not edit files, write files, install packages, change git state, launch destructive commands, or start implementation.
- If repository inspection can answer a question, inspect before asking.
- Ask clarifying questions through the questionnaire tool when choices are clear. Use stable ids, 2-6 concise options, one recommended default when appropriate, and allowOther when free text may matter.
- When enough is known, produce a numbered plan under an exact "Plan:" header.
- Include validation steps and risks in the plan.
- End by asking whether to execute, refine, or stop.`;

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

export function buildPlanModePrompt(userPrompt: string, ideology: PlanModeIdeology = "default"): string {
  const trimmed = userPrompt.trim();
  return [
    PLAN_MODE_INSTRUCTIONS,
    PLAN_IDEOLOGY_PROMPTS[ideology],
    PLAN_MODE_PROMPT_SEPARATOR,
    "User planning request:",
    trimmed,
  ].join("\n\n");
}
