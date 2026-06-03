import { useRef } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { CavemanSelector } from "./caveman-selector";
import { ComposerModeSelector } from "./composer-mode-selector";
import type { ComposerMode } from "./composer-mode";
import { ArrowUpIcon } from "./icons";
import type { CavemanLevel } from "./ipc";
import { ModelFeatureBadges } from "./model-feature-badges";
import { ModelSelector, type ModelSelectorHandle } from "./model-selector";

function resolveContextWindow(
  runtime: RuntimeSnapshot | undefined,
  provider: string | undefined,
  modelId: string | undefined,
): number | undefined {
  if (!provider || !modelId || !runtime?.models) {
    return undefined;
  }
  const model = runtime.models.find(
    (record) => record.providerId === provider && record.modelId === modelId,
  );
  const contextWindow = model?.contextWindow;
  return typeof contextWindow === "number" && contextWindow > 0 ? contextWindow : undefined;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  return String(Math.round(tokens));
}

interface PendingComposerProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
}

/**
 * Non-interactive replica of the in-thread composer (composer-panel.tsx).
 * Shown while a thread is still being created on the main process (before its
 * real session exists, so the live ComposerPanel can't render yet). Everything
 * is disabled — the real composer takes over the moment the session appears.
 */
export function PendingComposer({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
}: PendingComposerProps) {
  const modelSelectorRef = useRef<ModelSelectorHandle | null>(null);
  const contextWindow = resolveContextWindow(runtime, provider, modelId);

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <div className="composer__surface" aria-hidden="true">
          <div className="composer__editor">
            <textarea
              aria-label="Composer"
              disabled
              placeholder="message the clanker"
              readOnly
              rows={1}
              value=""
            />
            <div className="composer__bar">
              <div className="composer__footer">
                <div className="composer__context" aria-label="Context usage">
                  <div className="composer__context-track">
                    <div className="composer__context-fill" style={{ width: "0%" }} />
                  </div>
                  <span className="composer__context-label">
                    {contextWindow ? `0 / ${formatTokenCount(contextWindow)}` : "Context —"}
                  </span>
                </div>
                <div className="composer__footer-row">
                  <div className="composer__hint">
                    <span className="composer__hint-prose">Enter to send · Shift+Enter for newline</span>
                    <span className="composer__controls">
                      <span className="composer__controls-sep">{" \u00b7 "}</span>
                      <ComposerModeSelector mode={composerMode} disabled onSetMode={() => undefined} />
                      <span className="composer__controls-sep">{" \u00b7 "}</span>
                      <ModelSelector
                        ref={modelSelectorRef}
                        runtime={runtime}
                        provider={provider}
                        modelId={modelId}
                        thinkingLevel={thinkingLevel}
                        disabled
                        onSetModel={() => undefined}
                        onSetThinking={() => undefined}
                      />
                      <span className="composer__controls-sep">{" \u00b7 "}</span>
                      <CavemanSelector level={cavemanLevel} disabled onSetLevel={() => undefined} />
                      <ModelFeatureBadges runtime={runtime} provider={provider} modelId={modelId} />
                    </span>
                  </div>
                  <div className="composer__actions">
                    <button
                      aria-label="Send message"
                      className="button button--primary button--cta-icon composer__send"
                      type="button"
                      disabled
                    >
                      <ArrowUpIcon />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
