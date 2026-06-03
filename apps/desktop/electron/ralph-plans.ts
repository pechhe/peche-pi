import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RalphPlanSummary } from "../src/desktop-state";

const DEFAULT_MAX_ITERATIONS = 100;
const PROMPT_REF = "@.ralph/prompt.md";

/**
 * Discover Ralph plans in a workspace. A "plan" is a `.ralph/` bundle; there is
 * one per repo root. Existence is the only test — if the workspace has a
 * written plan (a non-empty `items.json`), it can be executed, so we surface
 * it. We deliberately do not inspect item pass-state or `loop.md`: those are
 * about loop progress, not about whether a plan exists to run.
 */
export function listRalphPlans(workspacePath: string): RalphPlanSummary[] {
  const ralphDir = join(workspacePath, ".ralph");

  const items = readItems(join(ralphDir, "items.json"));
  if (!items || items.length === 0) {
    return [];
  }

  return [
    {
      title: readPlanTitle(join(ralphDir, "plan.md")) ?? "Ralph plan",
      totalItems: items.length,
      doneItems: items.filter((item) => item.passes === true).length,
      promptRef: PROMPT_REF,
      defaultMaxIterations: DEFAULT_MAX_ITERATIONS,
    },
  ];
}

function readItems(path: string): { passes?: unknown }[] | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: { passes?: unknown }[] }).items;
    }
  } catch {
    // missing or malformed bundle -> no plan
  }
  return null;
}

function readPlanTitle(path: string): string | null {
  try {
    const heading = readFileSync(path, "utf-8").match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (!heading) {
      return null;
    }
    return heading.replace(/^Execution Plan:\s*/i, "").trim() || heading;
  } catch {
    return null;
  }
}
