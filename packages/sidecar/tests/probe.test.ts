/**
 * Tests for the Sidecar runtime compatibility probe.
 *
 * These tests validate the probe logic directly, without requiring
 * Bun to be the executing runtime. The actual Bun-vs-Node decision
 * is verified by running `bun run src/probe.ts` and
 * `node --import tsx src/probe.ts` separately.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

describe("sidecar probe — unit", () => {
  it("imports pi-coding-agent without throwing", async () => {
    const pi = await import("@earendil-works/pi-coding-agent");
    assert.equal(typeof pi.AgentSession, "function");
  });

  it("imports pi-sdk-driver without throwing", async () => {
    const sdk = await import("@pi-gui/pi-sdk-driver");
    assert.equal(typeof sdk.createPiSdkDriver, "function");
  });

  it("imports desktop-protocol without throwing", async () => {
    const dp = await import("@pi-gui/desktop-protocol");
    assert.equal(typeof dp.parseClientCommand, "function");
  });

  it("imports session-driver without throwing", async () => {
    await import("@pi-gui/session-driver");
  });

  it("imports catalogs without throwing", async () => {
    await import("@pi-gui/catalogs");
  });

  it("instantiates PiSdkDriver with a temp workspace", () => {
    const dir = join(tmpdir(), "pi-sidecar-test-" + Date.now());
    mkdirSync(dir, { recursive: true });
    try {
      // Dynamic import to avoid top-level side effects
      import("@pi-gui/pi-sdk-driver").then(({ createPiSdkDriver }) => {
        const driver = createPiSdkDriver({
          catalogFilePath: join(dir, "catalog.json"),
          agentDir: dir,
        });
        assert.ok(driver);
        assert.equal(typeof driver.supervisor, "object");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has a SIDECAR_VERSION constant", async () => {
    const { SIDECAR_VERSION } = await import("../src/index.js");
    assert.equal(typeof SIDECAR_VERSION, "string");
    assert.ok(SIDECAR_VERSION.length > 0);
  });
});
