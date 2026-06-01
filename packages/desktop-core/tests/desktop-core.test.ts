/**
 * Tests for the headless Desktop Core orchestration.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { DesktopCoreImpl } from "../src/desktop-core-impl.js";
import type { DesktopCore } from "../src/desktop-core.js";

describe("DesktopCore", () => {
  let dataDir: string;
  let core: DesktopCore;

  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), "pi-desktop-core-test-"));
  });

  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function freshCore(): Promise<DesktopCore> {
    const dir = mkdtempSync(join(tmpdir(), "pi-desktop-core-test-"));
    const c = new DesktopCoreImpl({ dataDir: dir });
    await c.initialize();
    return c;
  }

  it("initialises with empty state", async () => {
    const c = await freshCore();
    assert.equal(c.state.workspaces.length, 0);
    assert.equal(c.state.selectedWorkspaceId, null);
    assert.equal(c.state.selectedSessionId, null);
    assert.ok(c.state.revision >= 0);
  });

  it("emits state to subscribers", async () => {
    const c = await freshCore();
    const states: number[] = [];
    c.subscribeState((s) => states.push(s.revision));
    // Should have at least initial revision
    assert.ok(states.length >= 1);
  });

  it("adds a workspace", async () => {
    const c = await freshCore();
    // Use a temp dir that actually exists
    const wsDir = mkdtempSync(join(tmpdir(), "pi-test-ws-"));
    try {
      const state = await c.addWorkspace(wsDir);
      assert.equal(state.workspaces.length, 1);
      // macOS /tmp is a symlink to /private/tmp; resolve both sides
      assert.equal(realpathSync(state.workspaces[0]!.path), realpathSync(wsDir));
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it("throws selecting non-existent workspace", async () => {
    const c = await freshCore();
    await assert.rejects(
      () => c.selectWorkspace("nonexistent"),
      /Workspace not found/,
    );
  });

  it("throws removing non-existent workspace", async () => {
    const c = await freshCore();
    await assert.rejects(
      () => c.removeWorkspace("nonexistent"),
      /Workspace not found/,
    );
  });

  it("listWorkspaces returns snapshot", async () => {
    const c = await freshCore();
    const list = await c.listWorkspaces();
    assert.ok(Array.isArray(list.workspaces));
  });

  it("listSessions returns snapshot", async () => {
    const c = await freshCore();
    const list = await c.listSessions();
    assert.ok(Array.isArray(list.sessions));
  });

  it("selectWorkspace clears selected session", async () => {
    const c = await freshCore();
    const wsDir = mkdtempSync(join(tmpdir(), "pi-test-ws-"));
    try {
      const state = await c.addWorkspace(wsDir);
      const wsId = state.workspaces[0]!.id;
      const selected = await c.selectWorkspace(wsId);
      assert.equal(selected.selectedWorkspaceId, wsId);
      assert.equal(selected.selectedSessionId, null);
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it("flushPersistence does not throw", async () => {
    const c = await freshCore();
    await c.flushPersistence();
  });

  it("revision increments on state changes", async () => {
    const c = await freshCore();
    const initialRev = c.state.revision;
    const wsDir = mkdtempSync(join(tmpdir(), "pi-test-ws-"));
    try {
      await c.addWorkspace(wsDir);
      assert.ok(c.state.revision > initialRev);
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it("can create two independent cores", async () => {
    const c1 = await freshCore();
    const c2 = await freshCore();
    assert.notEqual(c1.state.revision, undefined);
    assert.notEqual(c2.state.revision, undefined);
  });
});
