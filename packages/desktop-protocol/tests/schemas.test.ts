import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as v from "valibot";
import {
  ClientHelloSchema,
  DesktopAppStateSchema,
  ServerAuthRejectedSchema,
  ServerEventEnvelopeSchema,
  ServerReadySchema,
} from "../src/schemas.js";
import { CommandSchemas } from "../src/commands.js";
import {
  parseClientCommand,
  parseEventPayload,
  parseServerEnvelope,
} from "../src/validate.js";
import { PROTOCOL_VERSION } from "../src/version.js";

const sampleState = {
  workspaces: [
    {
      id: "ws-1",
      name: "Demo",
      path: "/tmp/demo",
      lastOpenedAt: "2026-06-01T00:00:00.000Z",
      kind: "primary" as const,
      sessions: [
        {
          id: "s-1",
          title: "Hello",
          updatedAt: "2026-06-01T00:00:00.000Z",
          preview: "",
          status: "idle" as const,
          hasUnseenUpdate: false,
        },
      ],
    },
  ],
  worktreesByWorkspace: {},
  selectedWorkspaceId: "ws-1",
  selectedSessionId: "s-1",
  activeView: "threads" as const,
  composerDraft: "",
  composerDraftSyncSource: "state",
  composerDraftSyncNonce: 0,
  composerAttachments: [],
  queuedComposerMessages: [],
  runtimeByWorkspace: {},
  sessionCommandsBySession: {},
  sessionExtensionUiBySession: {},
  extensionCommandCompatibilityByWorkspace: {},
  notificationPreferences: {
    backgroundCompletion: true,
    backgroundFailure: true,
    attentionNeeded: true,
  },
  integratedTerminalShell: "/bin/zsh",
  lastViewedAtBySession: {},
  workspaceOrder: ["ws-1"],
  modelSettingsScopeMode: "per-repo" as const,
  globalModelSettings: { enabledModelPatterns: [] },
  sidebarCollapsed: false,
  enableTransparency: false,
  revision: 1,
};

describe("protocol version", () => {
  it("is currently 1", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });
});

describe("client hello", () => {
  it("accepts a valid hello envelope", () => {
    const parsed = v.parse(ClientHelloSchema, {
      type: "client-hello",
      version: PROTOCOL_VERSION,
      token: "abc",
    });
    assert.equal(parsed.version, 1);
  });

  it("rejects a wrong version", () => {
    assert.throws(() =>
      v.parse(ClientHelloSchema, {
        type: "client-hello",
        version: 999,
        token: "abc",
      }),
    );
  });

  it("rejects an empty token", () => {
    assert.throws(() =>
      v.parse(ClientHelloSchema, {
        type: "client-hello",
        version: PROTOCOL_VERSION,
        token: "",
      }),
    );
  });
});

describe("server envelopes", () => {
  it("parses server-ready", () => {
    const parsed = v.parse(ServerReadySchema, {
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 1234,
    });
    assert.equal(parsed.sidecarPid, 1234);
  });

  it("parses auth-rejected with a reason", () => {
    const parsed = v.parse(ServerAuthRejectedSchema, {
      type: "auth-rejected",
      reason: "bad token",
    });
    assert.equal(parsed.reason, "bad token");
  });

  it("parses event envelopes with arbitrary payloads", () => {
    const parsed = v.parse(ServerEventEnvelopeSchema, {
      type: "event",
      event: "state.changed",
      payload: sampleState,
    });
    assert.equal(parsed.event, "state.changed");
  });
});

describe("parseServerEnvelope", () => {
  it("dispatches the ready envelope", () => {
    const out = parseServerEnvelope({
      type: "server-ready",
      version: PROTOCOL_VERSION,
      sidecarPid: 7,
    });
    assert.equal(out.type, "server-ready");
  });

  it("rejects unknown envelope types", () => {
    assert.throws(() =>
      parseServerEnvelope({ type: "made-up", whatever: true }),
    );
  });
});

describe("commands", () => {
  it("parses workspace.addPath with a non-empty path", () => {
    const out = parseClientCommand({
      type: "command",
      id: "1",
      command: "workspace.addPath",
      payload: { path: "/tmp/x" },
    });
    assert.equal(out.command, "workspace.addPath");
  });

  it("rejects an empty path", () => {
    assert.throws(() =>
      parseClientCommand({
        type: "command",
        id: "1",
        command: "workspace.addPath",
        payload: { path: "" },
      }),
    );
  });

  it("rejects an unknown command name", () => {
    assert.throws(() =>
      parseClientCommand({
        type: "command",
        id: "1",
        command: "nope.thing",
        payload: {},
      }),
    );
  });

  it("rejects a payload missing required fields", () => {
    assert.throws(() =>
      parseClientCommand({
        type: "command",
        id: "1",
        command: "session.select",
        payload: { workspaceId: "ws" },
      }),
    );
  });

  it("parses composer.submit with optional deliverAs", () => {
    const out = parseClientCommand({
      type: "command",
      id: "1",
      command: "composer.submit",
      payload: { text: "hi", options: { deliverAs: "steer" } },
    });
    assert.equal(out.command, "composer.submit");
  });
});

describe("events", () => {
  it("round-trips a state snapshot payload", () => {
    const out = parseEventPayload("state.changed", sampleState);
    assert.equal(out.selectedWorkspaceId, "ws-1");
  });

  it("rejects a state snapshot missing required fields", () => {
    assert.throws(() =>
      v.parse(DesktopAppStateSchema, { workspaces: [] }),
    );
  });
});

describe("command catalog", () => {
  it("exposes a closed set of command names", () => {
    const names = Object.keys(CommandSchemas);
    assert.ok(names.includes("snapshot.getState"));
    assert.ok(names.includes("composer.submit"));
    assert.ok(names.includes("session.archive"));
  });
});
