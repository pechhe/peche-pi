import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const rawArgs = process.argv.slice(2);
const extraArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

// pnpm uses package filters to identify workspace packages
const packageFilters = ["@pi-gui/session-driver", "@pi-gui/pi-sdk-driver", "@pi-gui/catalogs"];

// Bun handles these manually by directory
const packagePaths = [
  path.resolve(repoRoot, "packages/session-driver"),
  path.resolve(repoRoot, "packages/pi-sdk-driver"),
  path.resolve(repoRoot, "packages/catalogs"),
];

const isBun = process.versions.bun || process.env.npm_config_user_agent?.includes("bun");

async function run(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${cmd} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function start(cmd, args, cwd) {
  return spawn(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

const children = [];

/** Label a child process so exit/error logs are traceable. */
function label(child, label) {
  child.__label = label;
  return child;
}

function logCrash(child, code, signal) {
  const label = child.__label ?? child.spawnfile ?? "unknown process";
  const reason = signal ? `killed by ${signal}` : `exit code ${code}`;
  const cwd = child.__cwd ?? "?";
  process.stderr.write(`
╔══════════════════════════════════════════════════════════════╗
║  DEV CRASH: ${label.padEnd(48).slice(0, 48)}║
║  ${reason.padEnd(56)}║
║  cwd: ${cwd.padEnd(51)}║
║  Electron crash log (if any):                               ║
║    ~/Library/Application Support/peche-pi/crash.log         ║
╚══════════════════════════════════════════════════════════════╝
`);
}

async function main() {
  if (isBun) {
    for (const pkgPath of packagePaths) {
      await run("bun", ["run", "build"], pkgPath);
    }
  } else {
    await run(
      "pnpm",
      ["--dir", repoRoot, "--filter", packageFilters[0], "--filter", packageFilters[1], "--filter", packageFilters[2], "run", "build"],
      desktopDir,
    );
  }

  if (isBun) {
    for (const pkgPath of packagePaths) {
      const name = path.basename(pkgPath);
      children.push(
        label(start("bun", ["x", "tsc", "-w", "-p", "tsconfig.json"], pkgPath), `tsc --watch (${name})`),
      );
    }
    children.push(
      label(start("bun", ["x", "electron-vite", "dev", "--watch", ...extraArgs], desktopDir), "electron-vite"),
    );
  } else {
    children.push(
      label(
        start(
          "pnpm",
          [
            "--dir",
            repoRoot,
            "--parallel",
            "--filter",
            packageFilters[0],
            "--filter",
            packageFilters[1],
            "--filter",
            packageFilters[2],
            "run",
            "build",
            "--watch",
          ],
          desktopDir,
        ),
        "pnpm build --watch",
      ),
    );
    children.push(
      label(start("pnpm", ["exec", "electron-vite", "dev", "--watch", ...extraArgs], desktopDir), "electron-vite"),
    );
  }

  let exiting = false;
  const stopChildren = () => {
    if (exiting) {
      return;
    }
    exiting = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  for (const child of children) {
    child.__cwd = child.spawnoptions?.cwd ?? desktopDir;
    child.once("exit", (code, signal) => {
      logCrash(child, code, signal);
      stopChildren();
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    child.once("error", (error) => {
      logCrash(child, error.errno ?? "spawn error", null);
      console.error(error);
      stopChildren();
      process.exitCode = 1;
    });
  }

  process.once("SIGINT", () => {
    stopChildren();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopChildren();
    process.exit(143);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});