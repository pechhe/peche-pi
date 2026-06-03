import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RalphPlanSummary } from "../src/desktop-state";

const DEFAULT_MAX_ITERATIONS = 100;
const PROMPT_REF = "@.ralph/prompt.md";

/**
 * Discover incomplete Ralph plans in a workspace. A "plan" is a `.ralph/`
 * bundle; there is one per repo root. A plan is incomplete unless its loop was
 * marked complete or every item already passes. Returns an empty list when no
 * launchable plan exists (so the new-thread Ralph button is disabled).
 */
export function listIncompleteRalphPlans(workspacePath: string): RalphPlanSummary[] {
  const ralphDir = join(workspacePath, ".ralph");

  const items = readItems(join(ralphDir, "items.json"));
  if (!items) {
    return [];
  }

  const totalItems = items.length;
  const doneItems = items.filter((item) => item.passes === true).length;

  const loop = readLoop(join(ralphDir, "loop.md"));
  const completed = loop.stopReason === "complete" || (totalItems > 0 && doneItems === totalItems);
  if (completed) {
    return [];
  }

  return [
    {
      title: readPlanTitle(join(ralphDir, "plan.md")) ?? "Ralph plan",
      totalItems,
      doneItems,
      promptRef: PROMPT_REF,
      defaultMaxIterations: loop.maxIterations ?? DEFAULT_MAX_ITERATIONS,
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

function readLoop(path: string): { stopReason?: string; maxIterations?: number } {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return {};
  }
  const stopReason = content.match(/^stop_reason:\s*"?([^"\n]*)"?/m)?.[1]?.trim();
  const maxRaw = content.match(/^max_iterations:\s*(\d+)/m)?.[1];
  const maxIterations = maxRaw ? Number.parseInt(maxRaw, 10) : undefined;
  return {
    ...(stopReason && stopReason !== "null" ? { stopReason } : {}),
    ...(maxIterations !== undefined && !Number.isNaN(maxIterations) ? { maxIterations } : {}),
  };
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
