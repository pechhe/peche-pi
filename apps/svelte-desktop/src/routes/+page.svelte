<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { setDesktopClient } from "../lib/context.js";
  import {
    createDesktopClientStore,
    type DesktopClientStore,
    type DesktopClientState,
    type CreateDesktopClientOptions,
  } from "../lib/desktop-client.js";
  import type { CoreWorkspaceRecord, CoreSessionRecord } from "@pi-gui/desktop-core";
  import ConnectionBadge from "../lib/components/ConnectionBadge.svelte";
  import WorkspacePanel from "../lib/components/WorkspacePanel.svelte";
  import SessionList from "../lib/components/SessionList.svelte";
  import Timeline from "../lib/components/Timeline.svelte";
  import Composer from "../lib/components/Composer.svelte";
  import ModelSettings from "../lib/components/ModelSettings.svelte";

  // Detect Playwright test mode via URL params
  let storeOptions: CreateDesktopClientOptions | undefined;
  if (browser) {
    const params = new URLSearchParams(window.location.search);
    const sidecarPort = params.get("sidecarPort");
    const sidecarToken = params.get("sidecarToken");
    if (sidecarPort && sidecarToken) {
      storeOptions = {
        getSidecarConnection: () =>
          Promise.resolve({
            port: parseInt(sidecarPort, 10),
            token: sidecarToken,
          }),
      };
    }
  }

  let client: DesktopClientStore = createDesktopClientStore(storeOptions);
  setDesktopClient(client);

  // Auto-connect when sidecar is available
  onMount(() => {
    // Slight delay to let Tauri bridge initialize
    const timer = setTimeout(() => {
      void client.commands.connect();
    }, 500);
    return () => clearTimeout(timer);
  });

  let snap = $state<DesktopClientState>(client.state);

  onMount(() => {
    return client.subscribe((s: DesktopClientState) => {
      snap = s;
    });
  });

  // Derived
  let activeSession = $derived(
    snap.selectedWorkspaceId && snap.selectedSessionId
      ? snap.workspaces
          .find((w: CoreWorkspaceRecord) => w.id === snap.selectedWorkspaceId)
          ?.sessions?.find((s: CoreSessionRecord) => s.id === snap.selectedSessionId)
      : undefined
  );

  let selectedWorkspaceSessions = $derived(
    snap.workspaces.find((w: CoreWorkspaceRecord) => w.id === snap.selectedWorkspaceId)?.sessions ?? []
  );

  let isRunning = $derived(activeSession?.status === "running");
  let canInteract = $derived(
    snap.connectionStatus === "connected" && snap.selectedWorkspaceId != null
  );

  // ── Command wrappers ─────────────────────────────

  async function addWorkspace(path: string) {
    try {
      await client.commands.sendCommand("workspace.addPath", { path });
    } catch (e) {
      console.error("addWorkspace failed:", e);
    }
  }

  async function selectWorkspace(workspaceId: string) {
    try {
      await client.commands.sendCommand("workspace.select", { workspaceId });
    } catch (e) {
      console.error("selectWorkspace failed:", e);
    }
  }

  async function removeWorkspace(workspaceId: string) {
    try {
      await client.commands.sendCommand("workspace.remove", { workspaceId });
    } catch (e) {
      console.error("removeWorkspace failed:", e);
    }
  }

  async function createSession(title: string) {
    try {
      await client.commands.sendCommand("session.create", {
        workspaceId: snap.selectedWorkspaceId,
        title,
      });
    } catch (e) {
      console.error("createSession failed:", e);
    }
  }

  async function selectSession(sessionId: string) {
    try {
      await client.commands.sendCommand("session.select", {
        workspaceId: snap.selectedWorkspaceId!,
        sessionId,
      });
      // Subscribe to session events for live streaming
      await client.commands.subscribeSession(
        snap.selectedWorkspaceId!,
        sessionId,
      );
    } catch (e) {
      console.error("selectSession failed:", e);
    }
  }

  async function archiveSession(sessionId: string) {
    try {
      await client.commands.sendCommand("session.archive", {
        workspaceId: snap.selectedWorkspaceId,
        sessionId,
      });
    } catch (e) {
      console.error("archiveSession failed:", e);
    }
  }

  async function sendMessage(text: string) {
    try {
      await client.commands.sendCommand("composer.submit", { text });
    } catch (e) {
      console.error("sendMessage failed:", e);
    }
  }

  async function cancelRun() {
    try {
      await client.commands.sendCommand("session.cancelCurrentRun", {});
    } catch (e) {
      console.error("cancelRun failed:", e);
    }
  }

  async function setDefaultModel(provider: string, modelId: string) {
    try {
      await client.commands.sendCommand("model.setDefaultModel", {
        workspaceId: snap.selectedWorkspaceId,
        provider,
        modelId,
      });
    } catch (e) {
      console.error("setDefaultModel failed:", e);
    }
  }

  async function setThinkingLevel(level: string) {
    try {
      await client.commands.sendCommand("model.setDefaultThinkingLevel", {
        workspaceId: snap.selectedWorkspaceId,
        thinkingLevel: level,
      });
    } catch (e) {
      console.error("setThinkingLevel failed:", e);
    }
  }
</script>

<svelte:head>
  <title>Pi Desktop</title>
</svelte:head>

<main class="desktop-shell">
  <header class="shell-header">
    <h1>Pi Desktop</h1>
    <span class="shell-subtitle">Svelte + Tauri Tracer Bullet</span>
    <div class="shell-actions">
      <ConnectionBadge
        status={snap.connectionStatus}
        error={snap.connectionError}
        onConnect={() => { void client.commands.connect(); }}
        onDisconnect={() => { void client.commands.disconnect(); }}
      />
    </div>
  </header>

  <section class="shell-body">
    <!-- Left sidebar: Workspaces + Sessions -->
    <div class="shell-left">
      <nav class="left-panel">
        <WorkspacePanel
          workspaces={snap.workspaces}
          selectedWorkspaceId={snap.selectedWorkspaceId}
          onAdd={addWorkspace}
          onSelect={selectWorkspace}
          onRemove={removeWorkspace}
        />
      </nav>
      <nav class="left-panel">
        <SessionList
          sessions={selectedWorkspaceSessions}
          selectedSessionId={snap.selectedSessionId}
          disabled={!canInteract}
          onCreate={createSession}
          onSelect={selectSession}
          onArchive={archiveSession}
        />
      </nav>
    </div>

    <!-- Main area: Timeline + Composer -->
    <div class="shell-main">
      <div class="timeline-area">
        <Timeline transcript={snap.transcript} isRunning={isRunning} />
      </div>
      <div class="composer-area">
        <Composer
          disabled={!canInteract || !snap.selectedSessionId}
          isRunning={isRunning}
          onSend={sendMessage}
          onCancel={cancelRun}
        />
      </div>
    </div>

    <!-- Right sidebar: Model Settings + known gaps -->
    <aside class="shell-right">
      <ModelSettings
        disabled={!canInteract}
        selectedWorkspaceId={snap.selectedWorkspaceId}
        selectedSessionId={snap.selectedSessionId}
        onSetDefaultModel={setDefaultModel}
        onSetThinkingLevel={setThinkingLevel}
      />
    </aside>
  </section>

  <footer class="shell-footer">
    <span class="known-gap" title="Terminal integration is deferred — not yet implemented in Svelte Desktop">Terminal not yet available</span>
    <span class="known-gap" title="Extension dock and dialog not yet ported">Extensions not yet available</span>
    <span class="known-gap" title="Worktree create/remove not yet implemented">Worktree not yet available</span>
    <span class="known-gap" title="Commit/push flows not yet implemented">Commit/Push not yet available</span>
    {#if snap.connectionStatus === "connected"}
      <span class="shell-pid">Sidecar PID: {snap.sidecarPid ?? "—"}</span>
    {/if}
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    overflow: hidden;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  .desktop-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Header ──────────────────────────────── */

  .shell-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 1rem;
    background: #16213e;
    border-bottom: 1px solid #0f3460;
    min-height: 36px;
    flex-shrink: 0;
  }

  .shell-header h1 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #e0e0e0;
  }

  .shell-subtitle {
    font-size: 0.7rem;
    color: #7f8c8d;
  }

  .shell-actions {
    margin-left: auto;
  }

  /* ── Body ────────────────────────────────── */

  .shell-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .shell-left {
    width: 240px;
    display: flex;
    flex-direction: column;
    background: #16213e;
    border-right: 1px solid #0f3460;
    flex-shrink: 0;
    overflow: hidden;
  }

  .left-panel {
    padding: 0.75rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .left-panel:first-child {
    border-bottom: 1px solid #0f3460;
    flex: 1;
  }

  .left-panel:last-child {
    flex: 1;
  }

  .shell-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .timeline-area {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .composer-area {
    flex-shrink: 0;
  }

  .shell-right {
    width: 240px;
    padding: 0.75rem;
    background: #16213e;
    border-left: 1px solid #0f3460;
    flex-shrink: 0;
    overflow-y: auto;
  }

  /* ── Footer ──────────────────────────────── */

  .shell-footer {
    display: flex;
    gap: 1rem;
    padding: 0.35rem 1rem;
    background: #0f3460;
    font-size: 0.7rem;
    flex-shrink: 0;
    align-items: center;
    flex-wrap: wrap;
  }

  .known-gap {
    color: #7f8c8d;
    font-style: italic;
    cursor: help;
  }

  .shell-pid {
    color: #2ecc71;
    font-size: 0.7rem;
    margin-left: auto;
  }
</style>
