import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlatformAdapter, setSessionVisibilityOverride } from "../src/index.js";
import type { SessionRef } from "@pi-gui/session-driver";

const sessionRef: SessionRef = { workspaceId: "ws-1", sessionId: "s-1" };

const baseState = {
  activeView: "threads" as const,
  selectedWorkspaceId: "ws-1",
  selectedSessionId: "s-1",
};

describe("platform adapter — session visibility", () => {
  it("returns false when state is undefined", () => {
    const adapter = createPlatformAdapter({ isWindowInFocus: () => true });
    assert.equal(adapter.isSessionActivelyViewed(undefined, sessionRef), false);
  });

  it("returns false when activeView is not threads", () => {
    const adapter = createPlatformAdapter({ isWindowInFocus: () => true });
    assert.equal(
      adapter.isSessionActivelyViewed({ ...baseState, activeView: "settings" }, sessionRef),
      false,
    );
  });

  it("returns false when selected session does not match", () => {
    const adapter = createPlatformAdapter({ isWindowInFocus: () => true });
    assert.equal(
      adapter.isSessionActivelyViewed({ ...baseState, selectedSessionId: "other" }, sessionRef),
      false,
    );
  });

  it("returns true when window is in focus and selection matches", () => {
    const adapter = createPlatformAdapter({ isWindowInFocus: () => true });
    assert.equal(adapter.isSessionActivelyViewed(baseState, sessionRef), true);
  });

  it("returns false when window is not in focus", () => {
    const adapter = createPlatformAdapter({ isWindowInFocus: () => false });
    assert.equal(adapter.isSessionActivelyViewed(baseState, sessionRef), false);
  });

  it("respects the test override (active) even when the window is unfocused", () => {
    setSessionVisibilityOverride("active");
    try {
      const adapter = createPlatformAdapter({ isWindowInFocus: () => false });
      assert.equal(adapter.isSessionActivelyViewed(baseState, sessionRef), true);
    } finally {
      setSessionVisibilityOverride(undefined);
    }
  });

  it("respects the test override (inactive) even when the window is focused", () => {
    setSessionVisibilityOverride("inactive");
    try {
      const adapter = createPlatformAdapter({ isWindowInFocus: () => true });
      assert.equal(adapter.isSessionActivelyViewed(baseState, sessionRef), false);
    } finally {
      setSessionVisibilityOverride(undefined);
    }
  });
});
