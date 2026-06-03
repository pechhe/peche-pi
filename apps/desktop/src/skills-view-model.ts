import type { RuntimeSkillRecord } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state";
import { titleCase } from "./string-utils.ts";

/**
 * Pure view-model helpers for the Skills surface.
 *
 * No React, no `window.piApp`, no hooks. Filtering, grouping, and the
 * small pieces of view-state mutation logic that don't need a renderer
 * live here so they can be unit-tested in isolation.
 *
 * The `useSkillsView` hook in `use-skills-view.ts` wires these helpers
 * to React state and `piApp` intents. The `<SkillsView>` /
 * `<SkillsSidebar>` components render the result.
 */

export interface SkillGroup {
  readonly key: string;
  readonly label: string;
  readonly skills: readonly RuntimeSkillRecord[];
}

/**
 * Filter a list of skills by a free-text query and a "show disabled"
 * toggle. Empty query passes everything; query is matched
 * case-insensitively against name, description, source, and slash
 * command.
 */
export function filterSkills(
  skills: readonly RuntimeSkillRecord[],
  query: string,
  showDisabled: boolean,
): readonly RuntimeSkillRecord[] {
  const normalized = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (!showDisabled && !skill.enabled) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return [skill.name, skill.description, skill.source, skill.slashCommand].some((value) =>
      value.toLowerCase().includes(normalized),
    );
  });
}

/**
 * Group a list of skills by their `source` field, alphabetically
 * sorting both groups and skills within each group. Skills with no
 * source fall under the `"other"` bucket.
 */
export function groupSkills(skills: readonly RuntimeSkillRecord[]): readonly SkillGroup[] {
  const buckets = new Map<string, RuntimeSkillRecord[]>();
  for (const skill of skills) {
    const key = skill.source || "other";
    const existing = buckets.get(key);
    if (existing) {
      existing.push(skill);
    } else {
      buckets.set(key, [skill]);
    }
  }
  return Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      label: titleCase(key),
      skills: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Toggle membership of `key` in a readonly Set, returning a new Set.
 * The skills view uses this to expand/collapse group headers.
 */
export function toggleSetMember<T>(set: ReadonlySet<T>, key: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * Resolve which workspace the Skills surface should target.
 *
 * Preference order:
 *   1. The explicit candidate, if it is a known root workspace.
 *   2. The currently-targeted workspace.
 *   3. The first root workspace in the list.
 *   4. Empty string (no workspace).
 *
 * Mirrors `openSkills` in the old App.tsx without smuggling in any
 * behaviour change.
 */
export function resolveSkillsWorkspaceId(
  candidate: string | undefined,
  current: string,
  rootWorkspaces: readonly WorkspaceRecord[],
): string {
  if (candidate && rootWorkspaces.some((workspace) => workspace.id === candidate)) {
    return candidate;
  }
  if (current && rootWorkspaces.some((workspace) => workspace.id === current)) {
    return current;
  }
  return rootWorkspaces[0]?.id ?? "";
}
