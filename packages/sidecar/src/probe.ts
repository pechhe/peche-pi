#!/usr/bin/env bun
/**
 * Sidecar runtime compatibility probe.
 *
 * Tests every runtime capability the Sidecar needs:
 *   1. Import pi-coding-agent and pi-sdk-driver packages
 *   2. Child-process spawning (node:child_process)
 *   3. Filesystem read/write/unlink (node:fs + node:fs/promises)
 *   4. JSON catalog / session persistence round-trip
 *   5. Instantiate a PiSdkDriver with a temp workspace
 *
 * Records a deterministic Node fallback path when Bun is unavailable
 * or a clear incompatibility is observed.
 *
 * Usage:
 *   bun run src/probe.ts          # Bun probe
 *   node --import tsx src/probe.ts  # Node fallback probe
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

interface ProbeResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

const results: ProbeResult[] = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  const marker = pass ? "✓" : "✗";
  console.log(`  ${marker} ${name}: ${detail}`);
}

function summary(): void {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length} probes: ${passed} pass, ${failed} fail`);
  if (failed > 0) {
    console.log("FAILED:");
    for (const r of results) {
      if (!r.pass) console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. Import capability
// ---------------------------------------------------------------------------

async function probeImports(): Promise<void> {
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    record(
      "pi-coding-agent import",
      typeof pi.AgentSession === "function",
      `AgentSession is ${typeof pi.AgentSession}`,
    );
  } catch (e) {
    record("pi-coding-agent import", false, String(e));
  }

  try {
    const sdk = await import("@pi-gui/pi-sdk-driver");
    record(
      "pi-sdk-driver import",
      typeof sdk.createPiSdkDriver === "function",
      `createPiSdkDriver is ${typeof sdk.createPiSdkDriver}`,
    );
  } catch (e) {
    record("pi-sdk-driver import", false, String(e));
  }

  try {
    const dp = await import("@pi-gui/desktop-protocol");
    record(
      "desktop-protocol import",
      typeof dp.parseClientCommand === "function",
      `parseClientCommand is ${typeof dp.parseClientCommand}`,
    );
  } catch (e) {
    record("desktop-protocol import", false, String(e));
  }

  try {
    const sd = await import("@pi-gui/session-driver");
    record("session-driver import", typeof sd === "object", "imported ok");
  } catch (e) {
    record("session-driver import", false, String(e));
  }

  try {
    const cat = await import("@pi-gui/catalogs");
    record("catalogs import", typeof cat === "object", "imported ok");
  } catch (e) {
    record("catalogs import", false, String(e));
  }
}

// ---------------------------------------------------------------------------
// 2. Child-process spawning
// ---------------------------------------------------------------------------

async function probeChildProcess(): Promise<void> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn("echo", ["probe-ok"]);
      let data = "";
      p.stdout.on("data", (d: Buffer) => (data += d.toString()));
      p.on("close", (code) =>
        code === 0 ? resolve(data.trim()) : reject(new Error(`exit ${code}`)),
      );
      p.on("error", reject);
    });
    record("child_process spawn", out === "probe-ok", `stdout: "${out}"`);
  } catch (e) {
    record("child_process spawn", false, String(e));
  }
}

// ---------------------------------------------------------------------------
// 3. Filesystem operations
// ---------------------------------------------------------------------------

function probeFilesystem(): void {
  const dir = join(tmpdir(), "pi-sidecar-probe-" + Date.now());
  try {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "probe.json");
    writeFileSync(p, JSON.stringify({ probe: true }), "utf8");

    const exists = existsSync(p);
    const data = JSON.parse(readFileSync(p, "utf8"));

    unlinkSync(p);

    record(
      "fs read/write/unlink",
      exists && data.probe === true,
      `wrote, verified, cleaned up`,
    );
  } catch (e) {
    record("fs operations", false, String(e));
  }
}

// ---------------------------------------------------------------------------
// 4. PiSdkDriver instantiation
// ---------------------------------------------------------------------------

async function probePiSdkDriver(): Promise<void> {
  const dir = join(tmpdir(), "pi-sidecar-driver-" + Date.now());
  try {
    mkdirSync(dir, { recursive: true });
    const { createPiSdkDriver } = await import("@pi-gui/pi-sdk-driver");

    const driver = createPiSdkDriver({
      catalogFilePath: join(dir, "catalog.json"),
      agentDir: dir,
    });

    record(
      "PiSdkDriver instantiation",
      typeof driver === "object" && driver !== null,
      `created ok, keys: ${Object.keys(driver).join(", ")}`,
    );
  } catch (e) {
    record("PiSdkDriver instantiation", false, String(e));
  }
}

// ---------------------------------------------------------------------------
// 5. Runtime detection
// ---------------------------------------------------------------------------

function probeRuntime(): void {
  // Bun exposes Bun.version; Node does not.
  const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";
  const bunVersion = isBun
    ? ((globalThis as Record<string, unknown>).Bun as { version: string }).version
    : null;

  if (isBun) {
    console.log(`Runtime: Bun ${bunVersion}`);
  } else {
    console.log(`Runtime: Node ${process.version}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  probeRuntime();
  console.log("");

  await probeImports();
  probeFilesystem();
  await probeChildProcess();
  await probePiSdkDriver();

  summary();

  // Record the deterministic fallback path
  const isBun = typeof (globalThis as Record<string, unknown>).Bun !== "undefined";
  if (isBun) {
    console.log(
      "\nSidecar runtime: Bun (preferred). Node fallback: `node --import tsx dist/sidecar.js`",
    );
  } else {
    console.log(
      "\nSidecar runtime: Node (fallback). Bun probe skipped — run `bun run src/probe.ts` to validate.",
    );
  }
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
