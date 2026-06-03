import { useEffect, useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, NewThreadEnvironment, WorkspaceRecord } from "./desktop-state";
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
import { ComposerAttachments, ComposerSurface } from "./composer-surface";
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
}: NewThreadViewProps) {
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);

  useEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 400)}px`;
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
          {attachments.length > 0 ? (
            <div className="composer__attachment-shelf">
              <ComposerAttachments attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
            </div>
          ) : null}
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
              textareaPlaceholder={composerMode === "plan" ? "Describe what you want to plan. Pi will grill you, write a PRD, then prepare Ralph." : "message the clanker"}
              screenFooter={(
                <div className="composer__context" aria-label="Context usage unavailable">
                  <div className="composer__context-track">
                    <div className="composer__context-fill" style={{ width: "0%" }} />
                  </div>
                  <span className="composer__context-label">Context —</span>
                </div>
              )}
              footer={(
                <NewThreadComposerFooter
                  runtime={runtime}
                  provider={provider}
                  modelId={modelId}
                  thinkingLevel={thinkingLevel}
                  cavemanLevel={cavemanLevel}
                  composerMode={composerMode}
                  modelOnboarding={modelOnboarding}
                  hasContent={Boolean(prompt.trim() || attachments.length > 0)}
                  modelSelectorRef={modelSelectorRef}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                  onSetCavemanLevel={onSetCavemanLevel}
                  onSetComposerMode={onSetComposerMode}
                  onSubmit={onSubmit}
                />
              )}
            />
          </div>
        </div>
        {!isChat ? (
          <div className="new-thread__options">
            <div className="new-thread__option">
              <span className="new-thread__option-label">Project</span>
              <select
                className="new-thread__project-select"
                aria-label="Project"
                value={selectedWorkspaceId}
                onChange={(event) => onSelectWorkspace(event.target.value)}
              >
                {workspaces.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="new-thread__option">
              <span className="new-thread__option-label">Environment</span>
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
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface NewThreadComposerFooterProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
  readonly modelOnboarding: ModelOnboardingState;
  readonly hasContent: boolean;
  readonly modelSelectorRef: RefObject<ModelSelectorHandle | null>;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly onSubmit: () => void;
}

function NewThreadComposerFooter({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  cavemanLevel,
  composerMode,
  modelOnboarding,
  hasContent,
  modelSelectorRef,
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onSetComposerMode,
  onSubmit,
}: NewThreadComposerFooterProps) {
  return (
    <>
      <div className="composer__footer">
        <div className="composer__footer-row">
          <div className="composer__hint new-thread__hint">
            <span className="composer__hint-prose">Enter to send · Shift+Enter for newline</span>
            <span className="composer__controls">
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
            <span className="composer__key-mount composer__key-mount--send">
              <button
                aria-label="Start thread"
                className="button button--primary button--cta-icon composer__send"
                type="button"
                disabled={!hasContent || modelOnboarding.requiresModelSelection}
                onClick={onSubmit}
              >
                <ArrowUpIcon />
              </button>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
