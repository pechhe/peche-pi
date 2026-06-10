import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureCommitBranch, slugify, isDetachedHead } from "./lazy-branch.ts";

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lazy-branch-test-"));
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  execSync("echo seed > file.txt && git add file.txt && git commit -m seed", {
    cwd: dir,
    shell: "/bin/bash",
    stdio: "ignore",
  });
  return dir;
}

function gitBranch(cwd: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
}

function makeBareRemote(dir: string): void {
  const bareDir = join(dir, ".bare-remote");
  execSync(`git init --bare ${bareDir}`, { stdio: "ignore" });
  execSync(`git remote add origin ${bareDir}`, { cwd: dir, stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test("slugify converts text to kebab-case", () => {
  assert.equal(slugify("My Feature Title!"), "my-feature-title");
  assert.equal(slugify("  spaces  everywhere  "), "spaces-everywhere");
  assert.equal(slugify(""), "");
  assert.equal(slugify("UPPER"), "upper");
  assert.equal(slugify("with-dashes-and_underscores"), "with-dashes-and-underscores");
});

test("slugify truncates at 50 chars", () => {
  const long = "a".repeat(100);
  assert.ok(slugify(long).length <= 50);
});

// ---------------------------------------------------------------------------
// isDetachedHead
// ---------------------------------------------------------------------------

test("isDetachedHead returns false on a branch", async () => {
  const dir = makeTempRepo();
  try {
    assert.equal(await isDetachedHead(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isDetachedHead returns true when detached", async () => {
  const dir = makeTempRepo();
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });
    assert.equal(await isDetachedHead(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — detached HEAD → creates branch
// ---------------------------------------------------------------------------

test("ensureCommitBranch creates a branch from detached HEAD", async () => {
  const dir = makeTempRepo();
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });
    assert.equal(await isDetachedHead(dir), true);

    const result = await ensureCommitBranch(dir, "My Feature Title!");

    assert.equal(result.created, true);
    assert.equal(result.branch, "my-feature-title");

    // HEAD is no longer detached
    assert.equal(await isDetachedHead(dir), false);
    assert.equal(gitBranch(dir), "my-feature-title");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — already on a branch → no-op
// ---------------------------------------------------------------------------

test("ensureCommitBranch returns created:false when already on a branch", async () => {
  const dir = makeTempRepo();
  try {
    assert.equal(gitBranch(dir), "main");

    const result = await ensureCommitBranch(dir, "should-not-matter");

    assert.equal(result.created, false);
    assert.equal(result.branch, "main");
    assert.equal(gitBranch(dir), "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — uniquification when branch exists
// ---------------------------------------------------------------------------

test("ensureCommitBranch appends suffix when slug branch already exists", async () => {
  const dir = makeTempRepo();
  try {
    // Create the branch that would collide with the slug
    execSync("git branch my-feature-title", { cwd: dir, stdio: "ignore" });

    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });

    const result = await ensureCommitBranch(dir, "My Feature Title!");

    assert.equal(result.created, true);
    assert.equal(result.branch, "my-feature-title-2");
    assert.equal(gitBranch(dir), "my-feature-title-2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureCommitBranch increments suffix past multiple collisions", async () => {
  const dir = makeTempRepo();
  try {
    execSync("git branch my-feature-title", { cwd: dir, stdio: "ignore" });
    execSync("git branch my-feature-title-2", { cwd: dir, stdio: "ignore" });
    execSync("git branch my-feature-title-3", { cwd: dir, stdio: "ignore" });

    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });

    const result = await ensureCommitBranch(dir, "My Feature Title!");

    assert.equal(result.created, true);
    assert.equal(result.branch, "my-feature-title-4");
    assert.equal(gitBranch(dir), "my-feature-title-4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — empty hint falls back to "feature"
// ---------------------------------------------------------------------------

test("ensureCommitBranch uses 'feature' fallback for empty hint", async () => {
  const dir = makeTempRepo();
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });

    const result = await ensureCommitBranch(dir, "");

    assert.equal(result.created, true);
    assert.equal(result.branch, "feature");
    assert.equal(gitBranch(dir), "feature");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — preserves staged changes through branch creation
// ---------------------------------------------------------------------------

test("ensureCommitBranch preserves staged/unstaged changes", async () => {
  const dir = makeTempRepo();
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });

    // Create an unstaged change
    execSync("echo dirty > new-file.txt", { cwd: dir, shell: "/bin/bash", stdio: "ignore" });

    await ensureCommitBranch(dir, "preserve-test");

    // The file should still be there
    const content = execSync("cat new-file.txt", { cwd: dir, encoding: "utf-8" }).trim();
    assert.equal(content, "dirty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ensureCommitBranch — push -u sets upstream (no LLM, no real remote)
// ---------------------------------------------------------------------------

test("push -u on a newly created branch sets upstream", async () => {
  const dir = makeTempRepo();
  try {
    makeBareRemote(dir);

    const sha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    execSync(`git checkout --detach ${sha}`, { cwd: dir, stdio: "ignore" });

    const result = await ensureCommitBranch(dir, "push-test");

    // Push with -u to set upstream
    execSync(`git push -u origin ${result.branch}`, { cwd: dir, stdio: "ignore" });

    // Verify upstream is set
    const upstreamRef = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    assert.equal(upstreamRef, `origin/${result.branch}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
