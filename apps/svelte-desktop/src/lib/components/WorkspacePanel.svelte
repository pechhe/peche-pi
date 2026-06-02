<script lang="ts">
  import type { CoreWorkspaceRecord } from "../desktop-client.js";

  interface Props {
    workspaces: readonly CoreWorkspaceRecord[];
    selectedWorkspaceId: string | null;
    onAdd: (path: string) => void;
    onSelect: (workspaceId: string) => void;
    onRemove: (workspaceId: string) => void;
  }

  let { workspaces, selectedWorkspaceId, onAdd, onSelect, onRemove }: Props = $props();

  let showAdd = $state(false);
  let addPath = $state("");

  function handleAdd() {
    const trimmed = addPath.trim();
    if (trimmed) {
      onAdd(trimmed);
      addPath = "";
      showAdd = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") { addPath = ""; showAdd = false; }
  }

  async function handleBrowse() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const folder = await invoke<string | null>("pick_folder");
      if (folder) {
        addPath = folder;
        onAdd(folder);
        addPath = "";
        showAdd = false;
      }
    } catch {
      // Tauri bridge unavailable — user can still type path manually
    }
  }
</script>

<aside class="workspace-panel">
  <div class="panel-header">
    <h2>Workspaces</h2>
    <button class="btn-icon" onclick={() => showAdd = !showAdd} title="Add workspace">
      +
    </button>
  </div>

  {#if showAdd}
    <div class="add-form">
      <input
        type="text"
        class="add-input"
        placeholder="Workspace path..."
        bind:value={addPath}
        onkeydown={handleKeydown}
      />
      <button class="btn-add" onclick={handleAdd}>Add</button>
      <button class="btn-browse" onclick={handleBrowse} title="Browse folder...">📁</button>
    </div>
  {/if}

  <ul class="workspace-list">
    {#each workspaces as ws (ws.id)}
      <li
        class="workspace-item"
        class:selected={ws.id === selectedWorkspaceId}
        tabindex="0"
        role="option"
        aria-selected={ws.id === selectedWorkspaceId}
        onclick={() => onSelect(ws.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(ws.id); } }}
      >
        <span class="ws-name">{ws.displayName}</span>
        <span class="ws-path">{ws.path}</span>
        <span class="ws-count">{ws.sessions?.length ?? 0} sessions</span>
        <button
          class="btn-remove"
          title="Remove workspace"
          onclick={(e) => { e.stopPropagation(); onRemove(ws.id); }}
        >
          ×
        </button>
      </li>
    {:else}
      <li class="empty-hint">No workspaces — add one above</li>
    {/each}
  </ul>
</aside>

<style>
  .workspace-panel {
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
  .btn-icon:hover { background: #1a5276; }

  .add-form {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .add-input {
    flex: 1;
    background: #0f3460;
    border: 1px solid #1a5276;
    color: #e0e0e0;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 0.75rem;
    outline: none;
  }
  .add-input:focus { border-color: #e94560; }

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

  .btn-browse {
    background: #0f3460;
    color: #e0e0e0;
    border: 1px solid #1a5276;
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .btn-browse:hover { background: #1a5276; }

  .workspace-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow-y: auto;
  }

  .workspace-item {
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    position: relative;
  }
  .workspace-item:hover { background: #1a1a3e; }
  .workspace-item.selected { background: #0f3460; border-left: 2px solid #e94560; }

  .ws-name {
    display: block;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .ws-path {
    display: block;
    font-size: 0.65rem;
    color: #7f8c8d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ws-count {
    font-size: 0.65rem;
    color: #555;
  }

  .btn-remove {
    position: absolute;
    right: 4px;
    top: 4px;
    background: transparent;
    color: #555;
    border: none;
    font-size: 1rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .workspace-item:hover .btn-remove { opacity: 1; }
  .btn-remove:hover { color: #e74c3c; }

  .empty-hint {
    font-size: 0.75rem;
    color: #555;
    font-style: italic;
    padding: 0.5rem;
  }
</style>
