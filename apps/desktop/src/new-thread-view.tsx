import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, NewThreadEnvironment, RalphPlanSummary, WorkspaceRecord } from "./desktop-state";
import type { ComposerMode } from "./composer-mode";
import { CavemanSelector } from "./caveman-selector";
import { ComposerModeSelector } from "./composer-mode-selector";
import { ModelFeatureBadges } from "./model-feature-badges";
import { ArrowUpIcon, PiLogoMark } from "./icons";
import {
  MODEL_OPTIONS_EMPTY_TITLE,
  type ComposerSlashCommand,
  type ComposerSlashCommandSection,
  type ComposerSlashOption,
  type ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { ModelOnboardingNoticeBanner } from "./model-onboarding-notice";
import type { ModelOnboardingState, ModelOnboardingSettingsSection } from "./model-onboarding";
import { ModelSelector } from "./model-selector";
import type { ModelSelectorHandle } from "./model-selector";
import type { CavemanLevel } from "./ipc";

interface NewThreadViewProps {
  readonly isChat?: boolean;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspaceId: string;
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly lastError?: string;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly modelOnboarding: ModelOnboardingState;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly modelSelectorRef: RefObject<ModelSelectorHandle | null>;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onChangePrompt: (prompt: string) => void;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onClearSlashCommand: () => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSelectMention: (filePath: string) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onSubmit: () => void;
  readonly onLaunchRalphPlan: (plan: RalphPlanSummary, maxIterations: number) => void;
}

export function NewThreadView({
  isChat = false,
  workspaces,
  selectedWorkspaceId,
  runtime,
  environment,
  prompt,
  attachments,
  lastError,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
  modelOnboarding,
  composerRef,
  modelSelectorRef,
  activeSlashCommand,
  activeSlashCommandMeta,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onChangePrompt,
  onSelectEnvironment,
  onSelectWorkspace,
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onSetComposerMode,
  onOpenModelSettings,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onClearSlashCommand,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSelectMention,
  onRemoveAttachment,
  onSubmit,
  onLaunchRalphPlan,
}: NewThreadViewProps) {
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);
  const ralphPlans = isChat ? [] : workspace?.ralphPlans ?? [];
  const [ralphDialogOpen, setRalphDialogOpen] = useState(false);

  useEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 260)}px`;
  }, [composerRef, prompt]);

  if (!isChat && !workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">New thread</div>
          <h1>Open a folder to begin</h1>
          <p>Select a repository from the sidebar first, then start a local or worktree-backed thread.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas canvas--new-thread">
      <div className="new-thread">
        <div className="new-thread__hero">
          <div className="new-thread__logo" data-testid="new-thread-logo">
            <PiLogoMark />
          </div>
          <div className="new-thread__eyebrow">{isChat ? "New chat" : "New thread"}</div>
          <h1 className="new-thread__title">{isChat ? "What\u2019s up?" : "Let\u2019s build"}</h1>
        </div>

        <div className="new-thread__composer composer">
          <div className="conversation conversation--composer">
            <ComposerSurface
              lastError={lastError}
              activeSlashCommand={activeSlashCommand}
              activeSlashCommandMeta={activeSlashCommandMeta}
              topNotice={(
                <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
              )}
              queuedMessages={[]}
              composerDraft={prompt}
              setComposerDraft={onChangePrompt}
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
              onEditQueuedMessage={() => undefined}
              onCancelQueuedEdit={() => undefined}
              onRemoveQueuedMessage={() => undefined}
              onSteerQueuedMessage={() => undefined}
              onRemoveAttachment={onRemoveAttachment}
              onSelectSlashCommand={onSelectSlashCommand}
              onSelectSlashOption={onSelectSlashOption}
              showMentionMenu={showMentionMenu}
              mentionOptions={mentionOptions}
              selectedMentionIndex={selectedMentionIndex}
              onSelectMention={onSelectMention}
              textareaLabel="New thread prompt"
              textareaTestId="new-thread-composer"
              textareaClassName="new-thread__textarea"
              textareaPlaceholder={composerMode === "plan" ? "Describe what you want to plan. Pi will grill you, write a PRD, then prepare Ralph." : "message the clanker"}
              footer={(
                <NewThreadComposerFooter
                  isChat={isChat}
                  runtime={runtime}
                  environment={environment}
                  provider={provider}
                  modelId={modelId}
                  thinkingLevel={thinkingLevel}
                  cavemanLevel={cavemanLevel}
                  composerMode={composerMode}
                  modelOnboarding={modelOnboarding}
                  hasContent={Boolean(prompt.trim() || attachments.length > 0)}
                  modelSelectorRef={modelSelectorRef}
                  onSelectEnvironment={onSelectEnvironment}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                  onSetCavemanLevel={onSetCavemanLevel}
                  onSetComposerMode={onSetComposerMode}
                  onSubmit={onSubmit}
                  ralphPlans={ralphPlans}
                  onOpenRalph={() => setRalphDialogOpen(true)}
                />
              )}
            />
          </div>
        </div>
      </div>
      {ralphDialogOpen ? (
        <RalphPlanDialog
          plans={ralphPlans}
          onClose={() => setRalphDialogOpen(false)}
          onLaunch={(plan, maxIterations) => {
            setRalphDialogOpen(false);
            onLaunchRalphPlan(plan, maxIterations);
          }}
        />
      ) : null}
    </section>
  );
}

interface NewThreadComposerFooterProps {
  readonly isChat: boolean;
  readonly runtime?: RuntimeSnapshot;
  readonly environment: NewThreadEnvironment;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly modelOnboarding: ModelOnboardingState;
  readonly hasContent: boolean;
  readonly modelSelectorRef: RefObject<ModelSelectorHandle | null>;
  readonly onSelectEnvironment: (environment: NewThreadEnvironment) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly onSubmit: () => void;
  readonly ralphPlans: readonly RalphPlanSummary[];
  readonly onOpenRalph: () => void;
}

function NewThreadComposerFooter({
  isChat,
  runtime,
  environment,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
  modelOnboarding,
  hasContent,
  modelSelectorRef,
  onSelectEnvironment,
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onSetComposerMode,
  onSubmit,
  ralphPlans,
  onOpenRalph,
}: NewThreadComposerFooterProps) {
  return (
    <>
      <div className="composer__footer">
        <div className="composer__footer-row">
          <div className="composer__hint new-thread__hint">
            <span className="composer__hint-prose">Enter to send · Shift+Enter for newline</span>
            <span className="composer__controls">
              {!isChat ? (
                <>
                  <span className="composer__controls-sep">{" \u00b7 "}</span>
                  <span className="new-thread__environment-group">
                    <button
                      className={`new-thread__environment ${environment === "local" ? "new-thread__environment--active" : ""}`}
                      type="button"
                      onClick={() => onSelectEnvironment("local")}
                    >
                      <span>Local</span>
                    </button>
                    <button
                      className={`new-thread__environment ${environment === "worktree" ? "new-thread__environment--active" : ""}`}
                      type="button"
                      onClick={() => onSelectEnvironment("worktree")}
                    >
                      <span>Worktree</span>
                    </button>
                  </span>
                </>
              ) : null}
              {!isChat ? (
                <>
                  <span className="composer__controls-sep">{" \u00b7 "}</span>
                  <button
                    className="new-thread__ralph"
                    type="button"
                    disabled={ralphPlans.length === 0}
                    title={
                      ralphPlans.length === 0
                        ? "No incomplete Ralph plans in this workspace"
                        : "Run a Ralph plan as a loop"
                    }
                    onClick={onOpenRalph}
                  >
                    Ralph
                  </button>
                </>
              ) : null}
              <span className="composer__controls-sep">{" \u00b7 "}</span>
              <ComposerModeSelector mode={composerMode} onSetMode={onSetComposerMode} />
              <span className="composer__controls-sep">{" \u00b7 "}</span>
              <ModelSelector
                ref={modelSelectorRef}
                runtime={runtime}
                provider={provider}
                modelId={modelId}
                thinkingLevel={thinkingLevel}
                dropdownPlacement="below"
                showEmptyModelControl
                unselectedModelLabel={modelOnboarding.unselectedModelLabel}
                emptyModelLabel={MODEL_OPTIONS_EMPTY_TITLE}
                emptyModelTitle={modelOnboarding.emptyModelTitle}
                onSetModel={onSetModel}
                onSetThinking={onSetThinking}
              />
              <span className="composer__controls-sep">{" \u00b7 "}</span>
              <CavemanSelector level={cavemanLevel} onSetLevel={onSetCavemanLevel} />
              <ModelFeatureBadges runtime={runtime} provider={provider} modelId={modelId} />
            </span>
          </div>

          <div className="composer__actions">
            <button
              aria-label="Start thread"
              className="button button--primary button--cta-icon composer__send"
              type="button"
              disabled={!hasContent || modelOnboarding.requiresModelSelection}
              onClick={onSubmit}
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const RALPH_MAX_ITERATION_OPTIONS = [5, 10, 20, 50, 100] as const;

function RalphPlanDialog({
  plans,
  onClose,
  onLaunch,
}: {
  readonly plans: readonly RalphPlanSummary[];
  readonly onClose: () => void;
  readonly onLaunch: (plan: RalphPlanSummary, maxIterations: number) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const plan = plans[selectedIndex] ?? plans[0];
  const [maxIterations, setMaxIterations] = useState(plan?.defaultMaxIterations ?? 100);

  if (!plan) {
    return null;
  }

  return (
    <div className="ralph-dialog__backdrop" role="presentation" onClick={onClose}>
      <div
        className="ralph-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Run a Ralph plan"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ralph-dialog__header">
          <h2 className="ralph-dialog__title">Run a Ralph plan</h2>
          <p className="ralph-dialog__subtitle">
            Starts a locked loop thread that runs the plan iteratively in fresh sessions.
          </p>
        </header>

        {plans.length > 1 ? (
          <ul className="ralph-dialog__plans">
            {plans.map((entry, index) => (
              <li key={`${entry.title}-${index}`}>
                <button
                  type="button"
                  className={`ralph-dialog__plan ${index === selectedIndex ? "ralph-dialog__plan--active" : ""}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="ralph-dialog__plan-title">{entry.title}</span>
                  <span className="ralph-dialog__plan-progress">
                    {entry.doneItems}/{entry.totalItems} items done
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ralph-dialog__plan-summary">
            <span className="ralph-dialog__plan-title">{plan.title}</span>
            <span className="ralph-dialog__plan-progress">
              {plan.doneItems}/{plan.totalItems} items done
            </span>
          </div>
        )}

        <label className="ralph-dialog__field">
          <span>Max iterations</span>
          <input
            type="number"
            min={1}
            value={maxIterations}
            onChange={(event) =>
              setMaxIterations(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
            }
          />
        </label>
        <div className="ralph-dialog__suggestions">
          {RALPH_MAX_ITERATION_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`ralph-dialog__suggestion ${value === maxIterations ? "ralph-dialog__suggestion--active" : ""}`}
              onClick={() => setMaxIterations(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <footer className="ralph-dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={() => onLaunch(plan, maxIterations)}>
            Run loop
          </button>
        </footer>
      </div>
    </div>
  );
}
