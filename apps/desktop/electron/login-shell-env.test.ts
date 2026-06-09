import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeShellEnv, parseShellEnvDump, shouldImportLoginShellEnv } from "./login-shell-env.ts";

const DELIMITER = "__PI_LOGIN_SHELL_ENV_DELIMITER_6f1c__";

test("parseShellEnvDump extracts pairs between delimiters and ignores banners", () => {
  const stdout = [
    "Welcome to your shell",
    `${DELIMITER}PATH=/a:/b`,
    "HOME=/Users/me",
    "FOO=bar=baz",
    `LAST=end${DELIMITER}`,
    "trailing profile noise",
  ].join("\n");
  const env = parseShellEnvDump(stdout);
  assert.equal(env.PATH, "/a:/b");
  assert.equal(env.HOME, "/Users/me");
  assert.equal(env.FOO, "bar=baz");
  assert.equal(env.LAST, "end");
});

test("parseShellEnvDump returns empty when delimiters are missing", () => {
  assert.deepEqual(parseShellEnvDump("PATH=/a\nHOME=/b"), {});
});

test("parseShellEnvDump skips invalid keys", () => {
  const stdout = `${DELIMITER}\n=novalue\n1BAD=x\nGOOD=y\n${DELIMITER}`;
  const env = parseShellEnvDump(stdout);
  assert.deepEqual(env, { GOOD: "y" });
});

test("mergeShellEnv unions PATH with shell entries first, de-duplicated", () => {
  const merged = mergeShellEnv(
    { PATH: "/opt/homebrew/bin:/usr/bin" },
    { PATH: "/Users/me/.pi/agent/bin:/usr/bin" },
  );
  assert.equal(merged.PATH, "/Users/me/.pi/agent/bin:/usr/bin:/opt/homebrew/bin");
});

test("mergeShellEnv fills missing keys but never clobbers existing ones", () => {
  const merged = mergeShellEnv(
    { PATH: "/usr/bin", EXISTING: "keep" },
    { EXISTING: "shell", BWS_TOKEN: "secret" },
  );
  assert.equal(merged.EXISTING, "keep");
  assert.equal(merged.BWS_TOKEN, "secret");
});

test("mergeShellEnv keeps current PATH when shell has none", () => {
  const merged = mergeShellEnv({ PATH: "/usr/bin" }, {});
  assert.equal(merged.PATH, "/usr/bin");
});

test("shouldImportLoginShellEnv: terminal launch (TERM set) is skipped", () => {
  assert.equal(shouldImportLoginShellEnv({ TERM: "xterm-256color" }), false);
});

test("shouldImportLoginShellEnv: GUI launch (no TERM) imports", () => {
  assert.equal(shouldImportLoginShellEnv({}), true);
});

test("shouldImportLoginShellEnv: explicit disable wins", () => {
  assert.equal(shouldImportLoginShellEnv({ PI_APP_DISABLE_SHELL_ENV: "1" }), false);
});

test("shouldImportLoginShellEnv: force overrides terminal skip", () => {
  assert.equal(shouldImportLoginShellEnv({ TERM: "xterm", PI_APP_FORCE_SHELL_ENV: "1" }), true);
});
