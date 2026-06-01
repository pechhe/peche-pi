<script lang="ts">
  interface Props {
    transcript: unknown[] | null;
    isRunning: boolean;
  }

  let { transcript, isRunning }: Props = $props();

  let containerEl = $state<HTMLDivElement>();

  $effect(() => {
    // Access transcript length to trigger scroll
    if (transcript && containerEl) {
      containerEl.scrollTop = containerEl.scrollHeight;
    }
  });

  function formatMessage(msg: unknown): { role: string; text: string } {
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      const role = typeof m.role === "string" ? m.role : "unknown";
      const text = typeof m.text === "string"
        ? m.text
        : typeof m.content === "string"
          ? m.content
          : JSON.stringify(m);
      return { role, text };
    }
    return { role: "unknown", text: String(msg) };
  }
</script>

<div class="timeline" bind:this={containerEl}>
  {#if transcript === null}
    <p class="empty-hint">Select a session to view transcript</p>
  {:else if transcript.length === 0}
    <p class="empty-hint">No messages yet — send one from the composer</p>
  {:else}
    {#each transcript as msg (transcript.indexOf(msg))}
      {@const { role, text } = formatMessage(msg)}
      <div class="message" class:msg-user={role === "user"} class:msg-assistant={role === "assistant"} class:msg-system={role === "system"}>
        <span class="msg-role">{role}</span>
        <div class="msg-text">{text}</div>
      </div>
    {/each}
  {/if}

  {#if isRunning}
    <div class="streaming-indicator">
      <span class="streaming-dot"></span>
      <span>Agent is responding...</span>
    </div>
  {/if}
</div>

<style>
  .timeline {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .message {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    max-width: 85%;
    line-height: 1.4;
  }

  .msg-user {
    align-self: flex-end;
    background: #0f3460;
    border-bottom-right-radius: 2px;
  }

  .msg-assistant {
    align-self: flex-start;
    background: #1a1a2e;
    border: 1px solid #333;
    border-bottom-left-radius: 2px;
  }

  .msg-system {
    align-self: center;
    background: transparent;
    border: 1px dashed #444;
    font-size: 0.75rem;
    color: #7f8c8d;
  }

  .msg-role {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #7f8c8d;
    margin-bottom: 2px;
    display: block;
  }

  .msg-text {
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .empty-hint {
    color: #555;
    font-style: italic;
    font-size: 0.85rem;
    text-align: center;
    margin-top: 2rem;
  }

  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    font-size: 0.8rem;
    color: #f0a500;
    align-self: flex-start;
  }

  .streaming-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f0a500;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
