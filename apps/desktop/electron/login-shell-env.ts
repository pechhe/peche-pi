import { spawnSync } from "node:child_process";

/**
 * GUI launches (Finder/Dock) start the app with a minimal environment: PATH is
 * trimmed and login-shell exports (custom PATH entries, tool/secret env) are
 * absent. Terminal launches inherit the full shell env. This module recovers
 * the user's login-shell environment and merges it into `process.env` so the
 * pi runtime shells out (e.g. `!`-prefixed provider headers, MCP tools) with
 * the same environment the terminal `pi` enjoys.
 */

// Unique enough to bracket the env dump without colliding with real values.
const DELIMITER = "__PI_LOGIN_SHELL_ENV_DELIMITER_6f1c__";

/**
 * Extract `KEY=value` pairs from the delimited `env` dump produced by the login
 * shell. Only the region between the first and last delimiter is parsed, so
 * profile banners printed before/after are ignored. Multi-line values are not
 * supported (rare for the vars we care about); such lines are dropped.
 */
export function parseShellEnvDump(stdout: string): Record<string, string> {
  const start = stdout.indexOf(DELIMITER);
  const end = stdout.lastIndexOf(DELIMITER);
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  const body = stdout.slice(start + DELIMITER.length, end);
  const env: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    env[key] = line.slice(eq + 1);
  }
  return env;
}

/**
 * Merge a resolved shell environment into the current environment.
 *
 * - PATH is unioned: shell entries first (they carry the user's real tooling),
 *   then any current-only entries, de-duplicated and order-preserving.
 * - Other keys are only filled in when missing, so Electron- or test-injected
 *   values are never clobbered.
 */
export function mergeShellEnv(
  current: NodeJS.ProcessEnv,
  shellEnv: Record<string, string>,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...current };

  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === "PATH") {
      continue;
    }
    if (merged[key] === undefined) {
      merged[key] = value;
    }
  }

  const shellPath = shellEnv.PATH ? shellEnv.PATH.split(":").filter(Boolean) : [];
  const currentPath = current.PATH ? current.PATH.split(":").filter(Boolean) : [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of [...shellPath, ...currentPath]) {
    if (!seen.has(entry)) {
      seen.add(entry);
      ordered.push(entry);
    }
  }
  if (ordered.length > 0) {
    merged.PATH = ordered.join(":");
  }

  return merged;
}

/**
 * Whether a login-shell env import should run for the current launch.
 *
 * Skipped on Windows, when explicitly disabled, and for terminal launches
 * (where the env is already complete) unless forced. `TERM` is the terminal
 * signal; Finder/Dock launches do not set it.
 */
export function shouldImportLoginShellEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform === "win32") {
    return false;
  }
  if (env.PI_APP_DISABLE_SHELL_ENV === "1") {
    return false;
  }
  if (env.PI_APP_FORCE_SHELL_ENV === "1") {
    return true;
  }
  return !env.TERM;
}

/**
 * Resolve the user's login-shell environment and merge it into `process.env`.
 *
 * Runs once, synchronously, at startup (mirroring the existing PATH patch so
 * env ordering is guaranteed before the runtime is created). Failures are
 * non-fatal: the caller's hard-coded PATH fallback still applies.
 */
export function importLoginShellEnv(): void {
  if (!shouldImportLoginShellEnv()) {
    return;
  }
  const shell = process.env.SHELL || "/bin/zsh";
  const command = `printf %s ${DELIMITER}; env; printf %s ${DELIMITER}`;
  const result = spawnSync(shell, ["-l", "-i", "-c", command], {
    timeout: 5000,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return;
  }
  const shellEnv = parseShellEnvDump(result.stdout);
  const merged = mergeShellEnv(process.env, shellEnv);
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}
