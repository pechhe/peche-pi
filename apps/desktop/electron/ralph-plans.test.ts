import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listIncompleteRalphPlans } from "./ralph-plans.ts";

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
    assert.deepEqual(listIncompleteRalphPlans(path), []);
  });
});

test("lists an incomplete plan with title and item counts", () => {
  withBundle(
    { items: INCOMPLETE_ITEMS, plan: "# Execution Plan: Deepen architecture\n\nbody" },
    (path) => {
      const plans = listIncompleteRalphPlans(path);
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

test("excludes a plan whose loop is marked complete", () => {
  withBundle(
    { items: INCOMPLETE_ITEMS, loop: '---\nstop_reason: "complete"\nmax_iterations: 9\n---\n' },
    (path) => {
      assert.deepEqual(listIncompleteRalphPlans(path), []);
    },
  );
});

test("excludes a plan where every item passes", () => {
  withBundle(
    { items: { version: 1, items: [{ passes: true }, { passes: true }] } },
    (path) => {
      assert.deepEqual(listIncompleteRalphPlans(path), []);
    },
  );
});

test("prefills max iterations from a prior loop run", () => {
  withBundle(
    {
      items: INCOMPLETE_ITEMS,
      plan: "# Build the thing\n",
      loop: '---\nrunning: false\nmax_iterations: 20\nstop_reason: "stop"\n---\n',
    },
    (path) => {
      const plans = listIncompleteRalphPlans(path);
      assert.equal(plans[0]?.defaultMaxIterations, 20);
      assert.equal(plans[0]?.title, "Build the thing");
    },
  );
});
