import { useRef, useEffect, useMemo } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ChassisAction } from "./chassis";
import { ComposerLayoutRenderer } from "./composer-layout-renderer";
import { getDefaultLayout, mergeChassisActionsIntoLayout, validateComposerLayout, controlUnitRegistry } from "./composer-layout";
import { registerChassisActionUnits } from "./composer-builtin-units";
import type { ComposerMode } from "./composer-mode";

import type { CavemanLevel } from "./ipc";
import {} from "./icons";
import { type ModelSelectorHandle } from "./model-selector";

interface PendingComposerProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly prompt?: string;
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
  prompt,
  chassisActions,
  onRunChassisAction,
  activeWrapId,
  onToggleChassisWrap,
}: PendingComposerProps) {
  // Register chassis actions as control units whenever they change
  useEffect(() => {
    if (chassisActions) {
      registerChassisActionUnits(chassisActions);
    }
  }, [chassisActions]);

  // Get effective layout - use default layout and add chassis actions
  const effectiveLayout = useMemo(() => {
    const availableUnitIds = new Set([
      ...controlUnitRegistry.getAll().map(u => u.id),
      ...(chassisActions?.map(a => `chassis:${a.id}`) ?? []),
    ]);
    const validatedLayout = validateComposerLayout(getDefaultLayout(), availableUnitIds);
    return mergeChassisActionsIntoLayout(validatedLayout, chassisActions ?? []);
  }, [chassisActions]);
  const modelSelectorRef = useRef<ModelSelectorHandle | null>(null);

  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <div className="composer__surface" aria-hidden="true">
          <div className="composer__editor">
            <textarea
              aria-label="Composer"
              placeholder=" message the clanker"
              readOnly
              rows={1}
              value={prompt ?? ""}
              tabIndex={-1}
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
                    <ComposerLayoutRenderer
                      layout={effectiveLayout}
                      runtime={runtime}
                      provider={provider}
                      modelId={modelId}
                      thinkingLevel={thinkingLevel}
                      cavemanLevel={cavemanLevel}
                      disabled
                      composerMode={composerMode}
                      modelSelectorRef={modelSelectorRef}
                      onSetComposerMode={() => undefined}
                      onSetModel={() => undefined}
                      onSetThinking={() => undefined}
                      onSetCavemanLevel={() => undefined}
                      onSubmit={() => {}}
                      hasModelSelection={false}
                      chassisActions={chassisActions}
                      onRunChassisAction={onRunChassisAction}
                      activeWrapId={activeWrapId}
                      onToggleChassisWrap={onToggleChassisWrap}
                    />
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
