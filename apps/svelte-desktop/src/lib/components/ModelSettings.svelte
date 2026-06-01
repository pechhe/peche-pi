<script lang="ts">
  interface Props {
    disabled: boolean;
    selectedWorkspaceId: string | null;
    selectedSessionId: string | null;
    onSetDefaultModel: (provider: string, modelId: string) => void;
    onSetThinkingLevel: (level: string) => void;
  }

  let { disabled, selectedWorkspaceId, selectedSessionId, onSetDefaultModel, onSetThinkingLevel }: Props = $props();

  let provider = $state("");
  let modelId = $state("");
  let thinkingLevel = $state("medium");

  const models: { provider: string; models: string[] }[] = [
    { provider: "anthropic", models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-3-5-20250514"] },
    { provider: "openai", models: ["gpt-4o", "gpt-4.1", "o4-mini"] },
    { provider: "google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  ];

  let availableModels = $derived(
    models.find(m => m.provider === provider)?.models ?? []
  );

  function handleSetModel() {
    if (provider && modelId) {
      onSetDefaultModel(provider, modelId);
    }
  }

  function handleSetThinking() {
    onSetThinkingLevel(thinkingLevel);
  }

  const thinkingOptions = [
    { value: "off", label: "Off" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
</script>

<aside class="model-settings">
  <h2>Model &amp; Settings</h2>

  <div class="setting-group">
    <label class="setting-label" for="model-provider">Default Model</label>
    <div class="setting-row">
      <select id="model-provider" class="setting-select" bind:value={provider} disabled={disabled}>
        <option value="">Select provider...</option>
        {#each models as m (m.provider)}
          <option value={m.provider}>{m.provider}</option>
        {/each}
      </select>
      <select class="setting-select" bind:value={modelId} disabled={disabled || !provider}>
        <option value="">Select model...</option>
        {#each availableModels as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </div>
    <button class="btn-setting" onclick={handleSetModel} disabled={disabled || !provider || !modelId}>
      Set Default
    </button>
  </div>

  <div class="setting-group">
    <label class="setting-label" for="thinking-level">Thinking Level</label>
    <div class="setting-row">
      <select id="thinking-level" class="setting-select" bind:value={thinkingLevel} disabled={disabled}>
        {#each thinkingOptions as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <button class="btn-setting" onclick={handleSetThinking} disabled={disabled}>
      Apply
    </button>
  </div>

  <div class="settings-meta">
    {#if !selectedWorkspaceId}
      <p class="known-gap">Select a workspace to configure models</p>
    {:else if disabled}
      <p class="known-gap">Connect to Sidecar to change settings</p>
    {/if}
  </div>
</aside>

<style>
  .model-settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.5rem 0;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #e94560;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .setting-label {
    font-size: 0.7rem;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .setting-row {
    display: flex;
    gap: 0.25rem;
  }

  .setting-select {
    flex: 1;
    background: #0f3460;
    border: 1px solid #1a5276;
    color: #e0e0e0;
    padding: 4px 6px;
    border-radius: 3px;
    font-size: 0.75rem;
    outline: none;
  }
  .setting-select:focus { border-color: #e94560; }
  .setting-select:disabled { opacity: 0.4; }

  .btn-setting {
    background: #0f3460;
    color: #e0e0e0;
    border: 1px solid #1a5276;
    border-radius: 3px;
    padding: 3px 10px;
    font-size: 0.75rem;
    cursor: pointer;
    margin-top: 2px;
  }
  .btn-setting:hover:not(:disabled) { background: #1a5276; }
  .btn-setting:disabled { opacity: 0.4; cursor: default; }

  .settings-meta {
    margin-top: 0.5rem;
  }

  .known-gap {
    color: #7f8c8d;
    font-style: italic;
    font-size: 0.75rem;
  }
</style>
