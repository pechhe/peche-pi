import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let cachedPiBinary: string | undefined;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Resolve the user's globally-installed `pi` CLI from a login shell so that
 * profile-managed PATH entries (npm-global, homebrew, etc.) are honoured.
 * Falls back to the bare command name if resolution fails.
 */
async function resolvePiBinary(): Promise<string> {
  if (cachedPiBinary) {
    return cachedPiBinary;
  }
  const shell = process.env.SHELL || "/bin/zsh";
  const resolved = await new Promise<string>((resolve) => {
    execFile(shell, ["-l", "-i", "-c", "command -v pi"], { timeout: 5000 }, (error, stdout) => {
      const candidate = stdout?.toString().trim().split("\n").pop()?.trim();
      resolve(error || !candidate ? "pi" : candidate);
    });
  });
  cachedPiBinary = resolved;
  return resolved;
}

/**
 * Open the chosen terminal application at `cwd` and resume the given pi session
 * file. Writes a temporary executable `.command` script and opens it with the
 * chosen app (`open -a <app>`); terminal apps execute `.command` scripts on
 * open. Falls back to the system handler when no app is provided.
 */
export async function launchSessionInDefaultTerminal(options: {
  readonly cwd: string;
  readonly sessionFilePath: string;
  readonly terminalApp?: string;
}): Promise<void> {
  const piBinary = await resolvePiBinary();
  const scriptDir = mkdtempSync(path.join(tmpdir(), "pi-resume-"));
  const scriptPath = path.join(scriptDir, "resume-session.command");
  const script = [
    "#!/bin/zsh -l",
    `cd ${shellQuote(options.cwd)} || exit 1`,
    `exec ${shellQuote(piBinary)} --session ${shellQuote(options.sessionFilePath)}`,
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf8");
  chmodSync(scriptPath, 0o755);

  // In automated tests we exercise the full handoff path but skip actually
  // launching the user's terminal application.
  if (process.env.PI_APP_TEST_MODE) {
    return;
  }

  const openArgs = options.terminalApp ? ["-a", options.terminalApp, scriptPath] : [scriptPath];
  await new Promise<void>((resolve, reject) => {
    execFile("open", openArgs, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
