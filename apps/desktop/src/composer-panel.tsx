import { type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, QueuedComposerMessage, RalphLoopStatus, SessionExtensionDialogRecord, SessionRecord } from "./desktop-state";
import type { ComposerMode } from "./composer-mode";
import { ComposerControlRow } from "./composer-control-row";
import { ArrowUpIcon, StopSquareIcon } from "./icons";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerAttachments, ComposerSurface } from "./composer-surface";
import { ToastHost } from "./toast";
import { QueuedComposerMessages } from "./queued-composer-messages";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import type { ModelSelectorHandle } from "./model-selector";
import type { CavemanLevel } from "./ipc";
import { QuestionnaireComposer } from "./questionnaire-composer";
import { playClick } from "./button-click-sound";

export interface LoopControlProps {
  readonly status: RalphLoopStatus;
  readonly onStop: () => void;
  readonly onResume: () => void;
  readonly onRestart: () => void;
}

export interface BeginRalphLoopProps {
  /** Title of the incomplete plan found in this workspace. */
  readonly planTitle: string;
  readonly onBegin: () => void;
}

interface ComposerPanelProps {
  readonly selectedSession: SessionRecord;
  /**
   * When present, the selected thread is a Ralph loop iteration: the normal
   * composer is replaced by a read-only control bar so the loop cannot be
   * interrupted by typing into the active iteration.
   */
  readonly loopControl?: LoopControlProps;
  /**
   * When present, this workspace has an incomplete Ralph plan ready to run. A
   * "Begin Ralph loop" banner appears above the composer to launch it.
   */
  readonly beginRalphLoop?: BeginRalphLoopProps;
  readonly runtime?: RuntimeSnapshot;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly modelSelectorRef: RefObject<ModelSelectorHandle | null>;
  readonly runningLabel: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly orchestratorMode?: boolean;
  readonly onToggleOrchestrator?: () => void;
  readonly blackholeAvailable: boolean;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  /** True once a plan-mode run has produced a plan and is idle, ready to execute. */
  readonly planReady?: boolean;
  /** Approve the written plan: sends an execute message and flips to build mode. */
  readonly onExecutePlan?: () => void;
  readonly modelOnboarding: ModelOnboardingState;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onSubmit: () => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly questionnaireRequest?: Extract<SessionExtensionDialogRecord, { readonly kind: "questionnaire" }>;
  readonly onRespondToQuestionnaire?: (response: import("@pi-gui/session-driver").HostUiResponse) => void;
}

function resolveFallbackContextWindow(
  session: SessionRecord,
  runtime?: RuntimeSnapshot,
): number | undefined {
  const provider = session.config?.provider;
  const modelId = session.config?.modelId;
  if (!provider || !modelId || !runtime?.models) {
    return undefined;
  }
  const model = runtime.models.find((record) => record.providerId === provider && record.modelId === modelId);
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

export function ComposerPanel({
  selectedSession,
  runtime,
  activeSlashCommand,
  activeSlashCommandMeta,
  composerDraft,
  setComposerDraft,
  composerRef,
  modelSelectorRef,
  runningLabel,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
  orchestratorMode,
  onToggleOrchestrator,
  blackholeAvailable,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onSetComposerMode,
  planReady,
  onExecutePlan,
  modelOnboarding,
  onOpenModelSettings,
  onSubmit,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  loopControl,
  beginRalphLoop,
  questionnaireRequest,
  onRespondToQuestionnaire,
}: ComposerPanelProps) {
  const questionnaireContent = questionnaireRequest && onRespondToQuestionnaire
    ? <QuestionnaireComposer request={questionnaireRequest} onRespond={onRespondToQuestionnaire} />
    : undefined;

  if (loopControl) {
    return <LoopControlBar {...loopControl} />;
  }

  const hasComposerInput = composerDraft.trim().length > 0 || attachments.length > 0;
  const primaryActionIsStop = selectedSession.status === "running" && !hasComposerInput;

  const fallbackModelContextWindow = resolveFallbackContextWindow(selectedSession, runtime);
  const contextUsage = selectedSession.contextUsage
    ?? (fallbackModelContextWindow !== undefined
      ? { usedTokens: 0, contextWindow: fallbackModelContextWindow }
      : undefined);
  const contextPercent = contextUsage
    ? Math.min(100, Math.max(0, (contextUsage.usedTokens / contextUsage.contextWindow) * 100))
    : 0;
  const compactThresholdTokens = contextUsage ? 81000 : undefined;
  const compactThresholdPercent = compactThresholdTokens && contextUsage
    ? Math.min(100, Math.max(0, (compactThresholdTokens / contextUsage.contextWindow) * 100))
    : 0;
  const compactTokensRemaining = contextUsage && compactThresholdTokens
    ? compactThresholdTokens - contextUsage.usedTokens
    : undefined;

  return (
    <footer className="composer">
      <ToastHost />
      {beginRalphLoop ? (
        <div className="composer__begin-loop">
          <button
            type="button"
            className="composer__begin-loop-button"
            onClick={beginRalphLoop.onBegin}
            title={`Ralph plan ready: ${beginRalphLoop.planTitle}`}
          >
            Begin Ralph loop
          </button>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="composer__attachment-shelf">
          <ComposerAttachments attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
        </div>
      ) : null}
      {queuedMessages.length > 0 || editingQueuedMessageId ? (
        <div className="composer__queued-shelf">
          <QueuedComposerMessages
            messages={queuedMessages}
            editingQueuedMessageId={editingQueuedMessageId}
            onEditMessage={onEditQueuedMessage}
            onCancelEdit={onCancelQueuedEdit}
            onRemoveMessage={onRemoveQueuedMessage}
            onSteerMessage={onSteerQueuedMessage}
          />
        </div>
      ) : null}
      <div className="conversation conversation--composer">
        <ComposerSurface
          activeSlashCommand={activeSlashCommand}
          activeSlashCommandMeta={activeSlashCommandMeta}
          topNotice={(
            <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
          )}
          composerDraft={composerDraft}
          setComposerDraft={setComposerDraft}
          composerRef={composerRef}
          attachments={attachments}
          slashSections={slashSections}
          slashOptions={slashOptions}
          selectedSlashCommand={selectedSlashCommand}
          selectedSlashOption={selectedSlashOption}
          showSlashMenu={showSlashMenu}
          showSlashOptionMenu={showSlashOptionMenu}
          slashOptionEmptyState={slashOptionEmptyState}
          onClearSlashCommand={onClearSlashCommand}
          onComposerKeyDown={onComposerKeyDown}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onRemoveAttachment={onRemoveAttachment}
          onSelectSlashCommand={onSelectSlashCommand}
          onSelectSlashOption={onSelectSlashOption}
          showMentionMenu={showMentionMenu}
          mentionOptions={mentionOptions}
          selectedMentionIndex={selectedMentionIndex}
          onSelectMention={onSelectMention}
          textareaLabel="Composer"
          textareaTestId="composer"
          textareaPlaceholder=" message the clanker"
          screenContent={questionnaireContent}
          screenFooter={(
            <div
              className="composer__context"
              aria-label={
                contextUsage
                  ? `Context usage ${formatTokenCount(contextUsage.usedTokens)} of ${formatTokenCount(contextUsage.contextWindow)} tokens`
                  : "Context usage unavailable"
              }
            >
              <div className="composer__context-track">
                {blackholeAvailable && contextUsage && compactThresholdTokens ? (
                  <div
                    className="composer__context-compact-tick"
                    style={{ left: `${compactThresholdPercent}%` }}
                    title={`Auto-compact at ${formatTokenCount(compactThresholdTokens)} tokens`}
                    aria-label={`Auto-compact at ${formatTokenCount(compactThresholdTokens)} tokens`}
                    data-label="auto"
                  />
                ) : null}
                <div className="composer__context-fill" style={{ width: `${contextPercent}%` }} />
              </div>
              <span className="composer__context-label">
                {contextUsage
                  ? `${formatTokenCount(contextUsage.usedTokens)} / ${formatTokenCount(contextUsage.contextWindow)}`
                  : "Context —"}
                {blackholeAvailable && contextUsage && compactTokensRemaining !== undefined ? (
                  <span className="composer__context-compact-label">
                    {compactTokensRemaining > 0
                      ? `Auto-compact in ${formatTokenCount(compactTokensRemaining)}`
                      : "Auto-compact ready"}
                  </span>
                ) : null}

              </span>

            </div>
          )}
          footer={(
            <div className="composer__footer">
              <div className="composer__footer-row">
                <div className="composer__hint">
                  <span className="composer__hint-prose">
                    {selectedSession.status === "running"
                      ? `${runningLabel} · Enter to queue · Cmd+Enter to steer`
                      : "Enter to send · Shift+Enter for newline"}
                  </span>
                  <ComposerControlRow
                    runtime={runtime}
                    provider={provider}
                    modelId={modelId}
                    thinkingLevel={thinkingLevel}
                    cavemanLevel={cavemanLevel}
                    composerMode={composerMode}
                    orchestratorMode={orchestratorMode}
                    onToggleOrchestrator={onToggleOrchestrator}
                    modelSelectorRef={modelSelectorRef}
                    unselectedModelLabel={modelOnboarding.unselectedModelLabel}
                    emptyModelTitle={modelOnboarding.emptyModelTitle}
                    onSetComposerMode={onSetComposerMode}
                    onSetModel={onSetModel}
                    onSetThinking={onSetThinking}
                    onSetCavemanLevel={onSetCavemanLevel}
                  />
                </div>
                <div className="composer__actions">
                  {composerMode === "plan" && planReady ? (
                    <button
                      type="button"
                      className="button button--primary composer__execute-plan"
                      title="Execute the plan and switch to Build mode"
                      onPointerDown={() => { playClick("down"); }}
                      onClick={() => onExecutePlan?.()}
                    >
                      Execute plan
                    </button>
                  ) : null}
                  <span className="composer__key-mount composer__key-mount--send">
                    <button
                      aria-label={primaryActionIsStop ? "Stop run" : "Send message"}
                      className="button button--primary button--cta-icon composer__send"
                      data-testid="send"
                      type="button"
                      disabled={
                        !primaryActionIsStop && modelOnboarding.requiresModelSelection
                      }
                      data-has-input={primaryActionIsStop || hasComposerInput ? "" : undefined}
                      onPointerDown={() => { playClick("down"); }}
                      onClick={onSubmit}
                    >
                      {primaryActionIsStop ? <StopSquareIcon /> : <ArrowUpIcon />}
                    </button>
                  </span>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    </footer>
  );
}

function LoopControlBar({ status, onStop, onResume, onRestart }: LoopControlProps) {
  const { running, iteration, maxIterations, stopReason } = status;
  const progress = `iteration ${iteration}/${maxIterations}`;
  return (
    <footer className="composer composer--loop">
      <div className="loop-control-bar">
        <div className="loop-control-bar__status">
          <span className="loop-control-bar__title">Ralph loop</span>
          <span className="loop-control-bar__detail">
            {running ? `Running · ${progress}` : `Stopped${stopReason ? ` · ${stopReason}` : ""} · ${progress}`}
          </span>
          <span className="loop-control-bar__hint">
            Input is disabled — each iteration runs in a fresh session so the loop is not interrupted.
          </span>
        </div>
        <div className="loop-control-bar__actions">
          {running ? (
            <button type="button" className="loop-control-bar__button" onClick={onStop}>
              Stop loop
            </button>
          ) : (
            <>
              <button type="button" className="loop-control-bar__button" onClick={onResume}>
                Resume
              </button>
              <button type="button" className="loop-control-bar__button" onClick={onRestart}>
                Restart
              </button>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
