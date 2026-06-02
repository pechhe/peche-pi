import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSkillRecord } from "@pi-gui/session-driver/runtime-types";
import type { WorkspaceRecord } from "./desktop-state.ts";
import {
  filterSkills,
  groupSkills,
  resolveSkillsWorkspaceId,
  toggleSetMember,
} from "./skills-view-model.ts";

function makeSkill(
  partial: Partial<RuntimeSkillRecord> & Pick<RuntimeSkillRecord, "name">,
): RuntimeSkillRecord {
  return {
    name: partial.name,
    description: partial.description ?? "",
    source: partial.source ?? "user",
    slashCommand: partial.slashCommand ?? `/${partial.name.toLowerCase()}`,
    filePath: partial.filePath ?? `${partial.name}.md`,
    enabled: partial.enabled ?? true,
  } as RuntimeSkillRecord;
}

function makeWorkspace(id: string): WorkspaceRecord {
  return { id, rootWorkspaceId: id, name: id, path: `/tmp/${id}` } as WorkspaceRecord;
}

/* ── filterSkills ─────────────────────────────────────────────── */

test("filterSkills with empty query returns all enabled skills when showDisabled is false", () => {
  const skills = [
    makeSkill({ name: "A", enabled: true }),
    makeSkill({ name: "B", enabled: false }),
    makeSkill({ name: "C", enabled: true }),
  ];
  const result = filterSkills(skills, "", false);
  assert.deepEqual(result.map((s) => s.name), ["A", "C"]);
});

test("filterSkills with empty query returns everything when showDisabled is true", () => {
  const skills = [
    makeSkill({ name: "A", enabled: true }),
    makeSkill({ name: "B", enabled: false }),
  ];
  const result = filterSkills(skills, "", true);
  assert.equal(result.length, 2);
});

test("filterSkills matches against name, description, source, and slashCommand case-insensitively", () => {
  const skills = [
    makeSkill({ name: "PlanMode", description: "create a plan" }),
    makeSkill({ name: "Other", description: "unrelated", slashCommand: "/special" }),
    makeSkill({ name: "Third", source: "system" }),
  ];
  assert.deepEqual(filterSkills(skills, "PLAN", true).map((s) => s.name), ["PlanMode"]);
  assert.deepEqual(filterSkills(skills, "special", true).map((s) => s.name), ["Other"]);
  assert.deepEqual(filterSkills(skills, "system", true).map((s) => s.name), ["Third"]);
});

test("filterSkills query is trimmed before matching", () => {
  const skills = [makeSkill({ name: "Alpha" })];
  assert.equal(filterSkills(skills, "   alpha   ", true).length, 1);
});

/* ── groupSkills ──────────────────────────────────────────────── */

test("groupSkills buckets by source, sorts groups alphabetically by label, skills alphabetically by name", () => {
  const skills = [
    makeSkill({ name: "Zeta", source: "user" }),
    makeSkill({ name: "Alpha", source: "user" }),
    makeSkill({ name: "Delta", source: "system" }),
  ];
  const groups = groupSkills(skills);
  assert.deepEqual(groups.map((g) => g.key), ["system", "user"]);
  assert.deepEqual(groups[0]!.skills.map((s) => s.name), ["Delta"]);
  assert.deepEqual(groups[1]!.skills.map((s) => s.name), ["Alpha", "Zeta"]);
});

test("groupSkills puts skills without a source into the 'other' bucket", () => {
  const skills = [makeSkill({ name: "Orphan", source: "" })];
  const groups = groupSkills(skills);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.key, "other");
});

/* ── toggleSetMember ──────────────────────────────────────────── */

test("toggleSetMember adds when missing, removes when present, returns a new Set each time", () => {
  const base = new Set<string>(["a"]);
  const added = toggleSetMember(base, "b");
  assert.equal(added.has("b"), true);
  assert.equal(added.has("a"), true);
  assert.notEqual(added, base);

  const removed = toggleSetMember(added, "a");
  assert.equal(removed.has("a"), false);
  assert.equal(removed.has("b"), true);
});

/* ── resolveSkillsWorkspaceId ────────────────────────────────── */

test("resolveSkillsWorkspaceId returns the explicit candidate when it is a known root workspace", () => {
  const roots = [makeWorkspace("alpha"), makeWorkspace("beta")];
  assert.equal(resolveSkillsWorkspaceId("beta", "alpha", roots), "beta");
});

test("resolveSkillsWorkspaceId falls back to the current workspace when the candidate is unknown", () => {
  const roots = [makeWorkspace("alpha"), makeWorkspace("beta")];
  assert.equal(resolveSkillsWorkspaceId("ghost", "alpha", roots), "alpha");
});

test("resolveSkillsWorkspaceId falls back to the first root workspace when neither candidate nor current is valid", () => {
  const roots = [makeWorkspace("alpha"), makeWorkspace("beta")];
  assert.equal(resolveSkillsWorkspaceId(undefined, "", roots), "alpha");
});

test("resolveSkillsWorkspaceId returns empty string when there are no root workspaces", () => {
  assert.equal(resolveSkillsWorkspaceId(undefined, "", []), "");
});
