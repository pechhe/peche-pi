<script lang="ts">
  import type { CoreSessionRecord } from "@pi-gui/desktop-core";

  interface Props {
    sessions: readonly CoreSessionRecord[];
    selectedSessionId: string | null;
    onCreate: (title: string) => void;
    onSelect: (sessionId: string) => void;
    onArchive: (sessionId: string) => void;
    disabled: boolean;
  }

  let { sessions, selectedSessionId, onCreate, onSelect, onArchive, disabled }: Props = $props();

  let showCreate = $state(false);
  let createTitle = $state("");

  function handleCreate() {
    const trimmed = createTitle.trim();
    if (trimmed) {
      onCreate(trimmed);
      createTitle = "";
      showCreate = false;
    }
  }

  function handleSessionKeydown(e: KeyboardEvent, sessionId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(sessionId);
    }
  }
</script>

<div class="session-list">
  <div class="panel-header">
    <h2>Sessions</h2>
    <button
      class="btn-icon"
      onclick={() => showCreate = !showCreate}
      disabled={disabled}
      title="New session"
    >
      +
    </button>
  </div>

  {#if showCreate}
    <div class="create-form">
      <input
        type="text"
        class="create-input"
        placeholder="Session title..."
        bind:value={createTitle}
        onkeydown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") { createTitle = ""; showCreate = false; }
        }}
      />
      <button class="btn-add" onclick={handleCreate}>Create</button>
    </div>
  {/if}

  <ul class="session-items">
    {#each sessions as s (s.id)}
      <li
        class="session-item"
        class:selected={s.id === selectedSessionId}
        tabindex="0"
        role="option"
        aria-selected={s.id === selectedSessionId}
        onclick={() => onSelect(s.id)}
        onkeydown={(e) => handleSessionKeydown(e, s.id)}
      >
        <span class="session-title">{s.title || "Untitled"}</span>
        <div class="session-meta">
          <span class="session-status" class:status-running={s.status === "running"} class:status-idle={s.status === "idle"} class:status-error={s.status === "error"}>
            {s.status}
          </span>
          {#if s.preview}
            <span class="session-preview">{s.preview}</span>
          {/if}
        </div>
        <button
          class="btn-archive"
          title="Archive session"
          onclick={(e) => { e.stopPropagation(); onArchive(s.id); }}
          disabled={disabled}
        >
          📦
        </button>
      </li>
    {:else}
      <li class="empty-hint">{disabled ? "Select a workspace first" : "No sessions — create one above"}</li>
    {/each}
  </ul>
</div>

<style>
  .session-list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .panel-header h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #e94560;
  }

  .btn-icon {
    background: #0f3460;
    color: #e0e0e0;
    border: 1px solid #1a5276;
    border-radius: 3px;
    width: 22px;
    height: 22px;
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn-icon:hover:not(:disabled) { background: #1a5276; }
  .btn-icon:disabled { opacity: 0.4; cursor: default; }

  .create-form {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .create-input {
    flex: 1;
    background: #0f3460;
    border: 1px solid #1a5276;
    color: #e0e0e0;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 0.75rem;
    outline: none;
  }
  .create-input:focus { border-color: #e94560; }

  .btn-add {
    background: #e94560;
    color: #fff;
    border: none;
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .btn-add:hover { background: #c0392b; }

  .session-items {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }

  .session-item {
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    position: relative;
  }
  .session-item:hover { background: #1a1a3e; }
  .session-item.selected { background: #0f3460; border-left: 2px solid #e94560; }

  .session-title {
    display: block;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .session-meta {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 2px;
  }

  .session-status {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: #333;
    text-transform: uppercase;
  }
  .status-running { background: #f0a500; color: #000; }
  .status-idle { background: #2ecc71; color: #000; }
  .status-error { background: #e74c3c; color: #fff; }

  .session-preview {
    font-size: 0.65rem;
    color: #7f8c8d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .btn-archive {
    position: absolute;
    right: 4px;
    top: 4px;
    background: transparent;
    border: none;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    padding: 0 2px;
  }
  .session-item:hover .btn-archive { opacity: 1; }
  .btn-archive:hover:not(:disabled) { filter: brightness(1.3); }
  .btn-archive:disabled { cursor: default; }

  .empty-hint {
    font-size: 0.75rem;
    color: #555;
    font-style: italic;
    padding: 0.5rem;
  }
</style>
