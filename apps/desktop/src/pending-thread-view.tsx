import { useRef } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ChassisAction } from "./chassis";
import { ComposerControlRow } from "./composer-control-row";
import type { ComposerMode } from "./composer-mode";
import { ArrowUpIcon } from "./icons";
import type { CavemanLevel } from "./ipc";
import { type ModelSelectorHandle } from "./model-selector";

interface PendingComposerProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly chassisActions?: readonly ChassisAction[];
  readonly onRunChassisAction?: (action: ChassisAction) => void;
  readonly activeWrapId?: string | null;
  readonly onToggleChassisWrap?: (action: ChassisAction) => void;
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
  chassisActions,
  onRunChassisAction,
  activeWrapId,
  onToggleChassisWrap,
}: PendingComposerProps) {
  const modelSelectorRef = useRef<ModelSelectorHandle | null>(null);

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <div className="composer__surface" aria-hidden="true">
          <div className="composer__editor">
            <textarea
              aria-label="Composer"
              disabled
              placeholder=" message the clanker"
              readOnly
              rows={1}
              value=""
            />
            <div className="composer__bar">
              <div className="composer__footer">
                <div className="composer__context" aria-label="Context usage unavailable">
                  <div className="composer__context-track">
                    <div className="composer__context-fill" style={{ width: "0%" }} />
                  </div>
                  <span className="composer__context-label">Context —</span>
                </div>
                <div className="composer__footer-row">
                  <div className="composer__hint">
                    <span className="composer__hint-prose">Enter to send · Shift+Enter for newline</span>
                    <ComposerControlRow
                      runtime={runtime}
                      provider={provider}
                      modelId={modelId}
                      thinkingLevel={thinkingLevel}
                      cavemanLevel={cavemanLevel}
                      composerMode={composerMode}
                      disabled
                      modelSelectorRef={modelSelectorRef}
                      onSetComposerMode={() => undefined}
                      onSetModel={() => undefined}
                      onSetThinking={() => undefined}
                      onSetCavemanLevel={() => undefined}
                      chassisActions={chassisActions}
                      onRunChassisAction={onRunChassisAction}
                      activeWrapId={activeWrapId}
                      onToggleChassisWrap={onToggleChassisWrap}
                    />
                  </div>
                  <div className="composer__actions">
                    <span className="composer__key-mount composer__key-mount--send">
                      <button
                        aria-label="Send message"
                        className="button button--primary button--cta-icon composer__send"
                        type="button"
                        disabled
                      >
                        <ArrowUpIcon />
                      </button>
                    </span>
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
