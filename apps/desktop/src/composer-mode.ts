export type ComposerMode = "build" | "plan";

const PLAN_MODE_INSTRUCTIONS = `Use the grill-with-docs skill for this request.

Run this as a first-class planning session, not as an implementation task.

Planning workflow:
1. Scope-check the request before diving in. If it is too broad for one grilling session, propose a smaller grillable slice.
2. Interview the user relentlessly until the design is resolved. Ask exactly one question at a time and wait for the user's answer before continuing.
3. Ask questions through the \`questionnaire\` tool when it is available — that opens pi-gui's native multi-choice dialog. Pass one or a small batch of questions, each with stable ids, 2-6 options, a \`recommended: true\` flag on your best default, and \`allowOther: true\` plus defer/prototype/stop escape options when free text matters. Fall back to plain prose only if the tool is missing.
4. If a question can be answered by reading the repository, inspect the code/docs instead of asking.
5. As terms are resolved, update CONTEXT.md inline when appropriate. Create ADRs sparingly for hard-to-reverse, surprising trade-offs.
6. When the grill naturally concludes or the user chooses stop, emit a decision log, create a PRD with the to-prd skill, then write a Ralph-loop-compatible task plan.
7. Do not launch Terminal from the skill. Instead, write a structured Ralph plan artifact under .pi/ralph/plans/ with the PRD link/path, decision log, and independently executable task prompts. pi-gui will use that artifact to start fresh desktop Pi sessions for Ralph tasks.

User planning request:`;

export function buildPlanModePrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  return `${PLAN_MODE_INSTRUCTIONS}\n\n${trimmed}`;
}
