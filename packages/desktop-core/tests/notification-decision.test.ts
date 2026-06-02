import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideNotification,
  type NotificationDecisionInput,
  type NotificationPreferencesInput,
} from "../src/index.js";

const allEnabled: NotificationPreferencesInput = {
  backgroundCompletion: true,
  backgroundFailure: true,
  attentionNeeded: true,
  playSound: true,
};

function input(overrides: Partial<NotificationDecisionInput> = {}): NotificationDecisionInput {
  return {
    eventKind: "runCompleted",
    preferences: allEnabled,
    isActivelyViewed: false,
    isWindowFocused: false,
    ...overrides,
  };
}

describe("decideNotification", () => {
  describe("preference gating", () => {
    it("suppresses runCompleted when backgroundCompletion is off", () => {
      const decision = decideNotification(
        input({ preferences: { ...allEnabled, backgroundCompletion: false } }),
      );
      assert.deepEqual(decision, { kind: "suppressed" });
    });

    it("suppresses runFailed when backgroundFailure is off", () => {
      const decision = decideNotification(
        input({
          eventKind: "runFailed",
          preferences: { ...allEnabled, backgroundFailure: false },
        }),
      );
      assert.deepEqual(decision, { kind: "suppressed" });
    });

    it("suppresses hostUiRequest when attentionNeeded is off", () => {
      const decision = decideNotification(
        input({
          eventKind: "hostUiRequest",
          preferences: { ...allEnabled, attentionNeeded: false },
        }),
      );
      assert.deepEqual(decision, { kind: "suppressed" });
    });
  });

  describe("window unfocused", () => {
    it("fires toast + sound when window is not focused", () => {
      const decision = decideNotification(input({ isWindowFocused: false }));
      assert.deepEqual(decision, { kind: "fire", toast: true, sound: true });
    });

    it("fires toast without sound when playSound is off", () => {
      const decision = decideNotification(
        input({
          isWindowFocused: false,
          preferences: { ...allEnabled, playSound: false },
        }),
      );
      assert.deepEqual(decision, { kind: "fire", toast: true, sound: false });
    });
  });

  describe("window focused", () => {
    it("fires sound only when window focused and same session viewed", () => {
      const decision = decideNotification(
        input({ isWindowFocused: true, isActivelyViewed: true }),
      );
      assert.deepEqual(decision, { kind: "fire", toast: false, sound: true });
    });

    it("fires sound only when window focused on different session", () => {
      const decision = decideNotification(
        input({ isWindowFocused: true, isActivelyViewed: false }),
      );
      assert.deepEqual(decision, { kind: "fire", toast: false, sound: true });
    });

    it("suppresses when window focused and playSound is off", () => {
      const decision = decideNotification(
        input({
          isWindowFocused: true,
          isActivelyViewed: true,
          preferences: { ...allEnabled, playSound: false },
        }),
      );
      assert.deepEqual(decision, { kind: "suppressed" });
    });
  });
});
