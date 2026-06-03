import { useRef } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { CavemanSelector } from "./caveman-selector";
import { ComposerModeSelector } from "./composer-mode-selector";
import type { ComposerMode } from "./composer-mode";
import type { ComposerAttachment } from "./desktop-state";
import { ArrowUpIcon, FileIcon } from "./icons";
import type { CavemanLevel } from "./ipc";
import { MessageMarkdown } from "./message-markdown";
import { ModelFeatureBadges } from "./model-feature-badges";
import { ModelSelector, type ModelSelectorHandle } from "./model-selector";
import { WorkingLabel } from "./working-label";

export interface PendingThreadViewProps {
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly runtime?: RuntimeSnapshot;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
}

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

/**
 * Placeholder session surface shown between the moment the user hits Enter
 * on the new-thread view and the moment the main process finishes spinning
 * up the agent runtime + initial snapshot refresh.
 *
 * Renders the same chrome as the real session view — conversation column,
 * user bubble, a left-aligned working indicator, and a disabled replica of
 * the in-thread composer — so the transition feels like the thread is
 * already live rather than a separate blocking dialog. The thread title
 * lives in the top toolbar, matching the real `canvas--thread` layout (which
 * has no in-canvas header).
 */
export function PendingThreadView({
  prompt,
  attachments,
  runtime,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
}: PendingThreadViewProps) {
  return (
    <>
      <section className="canvas canvas--thread">
        <div className="conversation conversation--thread">
          <div className="timeline-pane timeline-pane--thread" data-testid="timeline-pane">
            <div className="timeline" data-testid="transcript">
              <article className="timeline-item timeline-item--user timeline-item--just-sent">
                <div className="timeline-item__bubble">
                  {attachments.length > 0 ? (
                    <div className="timeline-item__attachments">
                      {attachments.map((attachment, index) =>
                        attachment.kind === "image" ? (
                          <img
                            alt={attachment.name ?? `Attachment ${index + 1}`}
                            className="timeline-item__attachment timeline-item__attachment--image"
                            key={`pending:${index}`}
                            src={`data:${attachment.mimeType};base64,${attachment.data}`}
                          />
                        ) : (
                          <div
                            className="timeline-item__attachment timeline-item__attachment--file"
                            key={`pending:${index}`}
                            title={attachment.fsPath}
                          >
                            <span className="timeline-item__attachment-icon" aria-hidden="true">
                              <FileIcon />
                            </span>
                            <span className="timeline-item__attachment-name">{attachment.name}</span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                  {prompt ? <MessageMarkdown text={prompt} /> : null}
                </div>
              </article>

              <div className="timeline-working" data-testid="timeline-working" aria-live="polite">
                <WorkingLabel label="Preparing your thread…" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <PendingComposer
        runtime={runtime}
        provider={provider}
        modelId={modelId}
        thinkingLevel={thinkingLevel}
        cavemanLevel={cavemanLevel}
        composerMode={composerMode}
      />
    </>
  );
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
 * Shown while the thread is starting so the bottom of the screen matches the
 * live session view instead of a blank gap. Everything is disabled — the real
 * composer takes over the moment the session snapshot arrives.
 */
function PendingComposer({
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
