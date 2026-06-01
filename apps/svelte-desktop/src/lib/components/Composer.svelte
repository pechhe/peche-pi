<script lang="ts">
  interface Props {
    disabled: boolean;
    isRunning: boolean;
    onSend: (text: string) => void;
    onCancel: () => void;
  }

  let { disabled, isRunning, onSend, onCancel }: Props = $props();

  let draft = $state("");
  let inputEl = $state<HTMLTextAreaElement>();

  function handleSend() {
    const trimmed = draft.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      draft = "";
      inputEl?.focus();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="composer">
  <textarea
    bind:this={inputEl}
    bind:value={draft}
    class="composer-input"
    placeholder={disabled ? "Select a session and connect to send messages..." : "Type a message... (Enter to send, Shift+Enter for newline)"}
    disabled={disabled}
    onkeydown={handleKeydown}
    rows="2"
  ></textarea>
  <div class="composer-actions">
    {#if isRunning}
      <button class="btn-cancel" onclick={onCancel} disabled={disabled}>
        ⏹ Cancel
      </button>
    {/if}
    <button
      class="btn-send"
      onclick={handleSend}
      disabled={disabled || !draft.trim()}
    >
      Send
    </button>
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #16213e;
    border-top: 1px solid #0f3460;
  }

  .composer-input {
    width: 100%;
    background: #0f3460;
    border: 1px solid #1a5276;
    color: #e0e0e0;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    font-family: inherit;
    resize: vertical;
    outline: none;
    line-height: 1.4;
    box-sizing: border-box;
  }
  .composer-input:focus { border-color: #e94560; }
  .composer-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .composer-input::placeholder { color: #555; }

  .composer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-send {
    background: #e94560;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 4px 16px;
    font-size: 0.8rem;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-send:hover:not(:disabled) { background: #c0392b; }
  .btn-send:disabled { opacity: 0.4; cursor: default; }

  .btn-cancel {
    background: #333;
    color: #e0e0e0;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .btn-cancel:hover:not(:disabled) { background: #444; }
  .btn-cancel:disabled { opacity: 0.4; cursor: default; }
</style>
