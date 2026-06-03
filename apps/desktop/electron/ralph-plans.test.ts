import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listRalphPlans } from "./ralph-plans.ts";

function withBundle(
  files: { items?: unknown; plan?: string; loop?: string } | null,
  run: (path: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "ralph-plans-"));
  try {
    if (files) {
      mkdirSync(join(root, ".ralph"), { recursive: true });
      if (files.items !== undefined) {
        writeFileSync(join(root, ".ralph", "items.json"), JSON.stringify(files.items), "utf-8");
      }
      if (files.plan !== undefined) {
        writeFileSync(join(root, ".ralph", "plan.md"), files.plan, "utf-8");
      }
      if (files.loop !== undefined) {
        writeFileSync(join(root, ".ralph", "loop.md"), files.loop, "utf-8");
      }
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const INCOMPLETE_ITEMS = {
  version: 1,
  items: [{ passes: true }, { passes: false }, { passes: false }],
};

test("returns empty when no .ralph bundle exists", () => {
  withBundle(null, (path) => {
    assert.deepEqual(listRalphPlans(path), []);
  });
});

test("lists a plan with title and item counts", () => {
  withBundle(
    { items: INCOMPLETE_ITEMS, plan: "# Execution Plan: Deepen architecture\n\nbody" },
    (path) => {
      const plans = listRalphPlans(path);
      assert.equal(plans.length, 1);
      assert.deepEqual(plans[0], {
        title: "Deepen architecture",
        totalItems: 3,
        doneItems: 1,
        promptRef: "@.ralph/prompt.md",
        defaultMaxIterations: 100,
      });
    },
  );
});

test("lists a plan even when a stale loop.md is marked complete", () => {
  withBundle(
    { items: INCOMPLETE_ITEMS, loop: '---\nstop_reason: "complete"\nmax_iterations: 9\n---\n' },
    (path) => {
      // loop.md is past-run state and is not reset when a new plan is written;
      // existence of items.json is all that matters.
      assert.equal(listRalphPlans(path).length, 1);
    },
  );
});

test("lists a plan even when every item already passes", () => {
  withBundle(
    { items: { version: 1, items: [{ passes: true }, { passes: true }] } },
    (path) => {
      const plans = listRalphPlans(path);
      assert.equal(plans.length, 1);
      assert.equal(plans[0]?.totalItems, 2);
      assert.equal(plans[0]?.doneItems, 2);
    },
  );
});

test("returns empty when items.json has no items", () => {
  withBundle({ items: { version: 1, items: [] } }, (path) => {
    assert.deepEqual(listRalphPlans(path), []);
  });
});
