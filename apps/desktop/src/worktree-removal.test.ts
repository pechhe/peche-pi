import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRemovalConfirm } from "./worktree-removal.ts";

describe("buildRemovalConfirm", () => {
  it("returns force:false and clean message for clean worktree", () => {
    const result = buildRemovalConfirm(
      { uncommittedFiles: 0, unpushedCommits: 0 },
      "my-feature",
    );
    assert.equal(result.force, false);
    assert.match(result.message, /clean/i);
    assert.match(result.message, /my-feature/);
  });

  it("returns force:true with counts for dirty worktree", () => {
    const result = buildRemovalConfirm(
      { uncommittedFiles: 3, unpushedCommits: 2 },
      "dirty-branch",
    );
    assert.equal(result.force, true);
    assert.match(result.message, /dirty-branch/);
    assert.match(result.message, /3 uncommitted/);
    assert.match(result.message, /2 unpushed/);
  });
});
