import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/** Default idle (no-bytes) timeout for streaming HTTP, matching the pi CLI. */
export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

export interface HttpIdleDispatcherOptions {
  readonly allowH2: false;
  readonly bodyTimeout: number;
  readonly headersTimeout: number;
}

/**
 * Normalize a requested idle timeout into undici dispatcher options.
 *
 * - Non-finite or negative values fall back to the default.
 * - Fractional values are floored.
 * - `0` is preserved: undici treats `0` as "no timeout".
 */
export function httpIdleDispatcherOptions(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): HttpIdleDispatcherOptions {
  const normalized =
    Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.floor(timeoutMs) : DEFAULT_HTTP_IDLE_TIMEOUT_MS;
  return { allowH2: false, bodyTimeout: normalized, headersTimeout: normalized };
}

/**
 * Install a process-global undici dispatcher with an idle timeout on response
 * headers and body. undici's `bodyTimeout` resets on every received chunk, so a
 * stalled / half-open socket (dropped wifi, dead proxy) is aborted while a
 * slow-but-active stream keeps running. `setGlobalDispatcher` also governs the
 * Node/Electron built-in `fetch` used by the provider SDKs (shared global
 * dispatcher symbol).
 *
 * The pi CLI installs this at startup (`configureHttpDispatcher`). The desktop
 * app embeds the runtime as a library and otherwise never installs it, so a
 * half-open socket hangs forever: the agent run never settles and blocks all
 * future prompts / `continue` ("Agent is already processing"). This restores
 * CLI parity. Pass `0` to disable.
 */
export function installHttpIdleTimeout(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
  setGlobalDispatcher(new EnvHttpProxyAgent(httpIdleDispatcherOptions(timeoutMs)));
}
