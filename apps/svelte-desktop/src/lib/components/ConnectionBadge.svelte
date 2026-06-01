<script lang="ts">
  import type { ConnectionStatus } from "../desktop-client.js";

  interface Props {
    status: ConnectionStatus;
    error: string | null;
    onConnect: () => void;
    onDisconnect: () => void;
  }

  let { status, error, onConnect, onDisconnect }: Props = $props();
</script>

<div class="connection-badge">
  <span
    class="status-dot"
    class:dot-disconnected={status === "disconnected"}
    class:dot-connecting={status === "connecting"}
    class:dot-connected={status === "connected"}
    class:dot-error={status === "error"}
  ></span>
  <span class="status-label">{status}</span>
  {#if error}
    <span class="status-error" title={error}>⚠</span>
  {/if}
  {#if status === "disconnected" || status === "error"}
    <button class="btn-connect" onclick={onConnect}> Connect </button>
  {:else if status === "connected"}
    <button class="btn-connect" onclick={onDisconnect}> Disconnect </button>
  {/if}
</div>

<style>
  .connection-badge {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    padding: 0 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot-disconnected { background: #555; }
  .dot-connecting { background: #f0a500; animation: pulse 1s infinite; }
  .dot-connected { background: #2ecc71; }
  .dot-error { background: #e74c3c; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-label {
    color: #b0b0b0;
    text-transform: capitalize;
  }

  .status-error {
    color: #e74c3c;
    cursor: help;
  }

  .btn-connect {
    background: #0f3460;
    color: #e0e0e0;
    border: 1px solid #1a5276;
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 0.7rem;
    cursor: pointer;
    margin-left: 0.25rem;
  }
  .btn-connect:hover {
    background: #1a5276;
  }
</style>
