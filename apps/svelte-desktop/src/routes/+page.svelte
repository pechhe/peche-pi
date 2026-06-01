<script lang="ts">
  /// <reference types="@sveltejs/kit" />
</script>

<svelte:head>
  <title>Pi Desktop</title>
</svelte:head>

<main class="desktop-shell">
  <header class="shell-header">
    <h1>Pi Desktop</h1>
    <span class="shell-status">Svelte + Tauri Tracer Bullet</span>
  </header>

  <section class="shell-body">
    <aside class="shell-sidebar">
      <h2>Workspaces</h2>
      <p class="known-gap">Workspace list — coming soon</p>
    </aside>

    <div class="shell-main">
      <div class="shell-timeline">
        <h2>Timeline</h2>
        <p class="known-gap">Timeline / transcript — coming soon</p>
      </div>

      <div class="shell-composer">
        <h2>Composer</h2>
        <p class="known-gap">Message composer — coming soon</p>
      </div>
    </div>

    <aside class="shell-settings">
      <h2>Settings</h2>
      <p class="known-gap">Model &amp; settings — coming soon</p>
    </aside>
  </section>

  <footer class="shell-footer">
    <span class="known-gap">Terminal not yet available</span>
    <span class="known-gap">Extensions not yet available</span>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
  }

  .desktop-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .shell-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background: #16213e;
    border-bottom: 1px solid #0f3460;
  }

  .shell-header h1 {
    margin: 0;
    font-size: 1rem;
  }

  .shell-status {
    font-size: 0.75rem;
    color: #7f8c8d;
  }

  .shell-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .shell-sidebar,
  .shell-settings {
    width: 220px;
    padding: 1rem;
    background: #16213e;
    border-right: 1px solid #0f3460;
  }

  .shell-settings {
    border-right: none;
    border-left: 1px solid #0f3460;
  }

  .shell-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .shell-timeline {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
  }

  .shell-composer {
    padding: 1rem;
    border-top: 1px solid #0f3460;
    background: #16213e;
  }

  .shell-footer {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background: #0f3460;
    font-size: 0.75rem;
  }

  .known-gap {
    color: #7f8c8d;
    font-style: italic;
    font-size: 0.85rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #e94560;
  }
</style>
