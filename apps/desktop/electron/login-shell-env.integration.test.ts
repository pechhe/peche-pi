import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importLoginShellEnv } from "./login-shell-env.ts";

// Real-shell proof: a GUI-style launch (no TERM) must recover the user's
// login-shell PATH additions and exported vars. Uses zsh with a custom ZDOTDIR
// so the test controls the startup files. Skips on non-macOS / when zsh absent.
test("importLoginShellEnv recovers custom PATH + exported var from a real login shell", { skip: process.platform !== "darwin" }, () => {
  const zdotdir = mkdtempSync(path.join(tmpdir(), "pi-shell-env-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "pi-shell-bin-"));

  // zsh login+interactive sources .zprofile then .zshrc from ZDOTDIR.
  writeFileSync(
    path.join(zdotdir, ".zshrc"),
    [
      `export PATH="${binDir}:$PATH"`,
      `export PI_TEST_SENTINEL=hello-from-rc`,
      "",
    ].join("\n"),
    "utf8",
  );

  const saved = { ...process.env };
  try {
    process.env.SHELL = "/bin/zsh";
    process.env.ZDOTDIR = zdotdir;
    process.env.PI_APP_FORCE_SHELL_ENV = "1";
    delete process.env.TERM;
    delete process.env.PI_TEST_SENTINEL;

    importLoginShellEnv();

    assert.equal(process.env.PI_TEST_SENTINEL, "hello-from-rc", "exported rc var should be imported");
    assert.ok(
      (process.env.PATH ?? "").split(":").includes(binDir),
      `PATH should include rc-added dir ${binDir}; got ${process.env.PATH}`,
    );
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, saved);
    rmSync(zdotdir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});
