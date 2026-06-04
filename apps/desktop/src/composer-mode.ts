export type ComposerMode = "build" | "plan";

const PLAN_MODE_INSTRUCTIONS = `Run this as pi-gui Plan mode: read-only exploration first, implementation later only after user approval.

Plan mode rules:
- You are currently restricted to read-only tools: read, grep, find, ls, and questionnaire.
- Do not edit files, write files, install packages, change git state, launch destructive commands, or start implementation.
- If repository inspection can answer a question, inspect before asking.
- Ask clarifying questions through the questionnaire tool when choices are clear. Use stable ids, 2-6 concise options, one recommended default when appropriate, and allowOther when free text may matter.
- Ask one focused question at a time unless several questions are tightly coupled.
- When enough is known, produce a numbered plan under an exact "Plan:" header.
- Include validation steps and risks in the plan.
- End by asking whether to execute, refine, or stop.

Plan format:
Plan:
1. First concrete step
2. Second concrete step
3. Verification step

User planning request:`;

export function buildPlanModePrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  return `${PLAN_MODE_INSTRUCTIONS}\n\n${trimmed}`;
}
