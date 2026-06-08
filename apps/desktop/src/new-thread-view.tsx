import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, NewThreadEnvironment, WorkspaceRecord } from "./desktop-state";
import type { ComposerMode } from "./composer-mode";
import { ComposerControlRow } from "./composer-control-row";
import { ArrowUpIcon, ChevronDownIcon, MonitorIcon, PiLogoMark, WorktreeIcon } from "./icons";
import { useButtonSound } from "./use-button-sound";
import { playClick } from "./button-click-sound";
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
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetComposerMode: (mode: ComposerMode) => void;
  readonly orchestratorMode?: boolean;
  readonly onToggleOrchestrator?: () => void;
  readonly onOpenModelSettings: (section: ModelOnboardingSettingsSection) => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onClearSlashCommand: () => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSelectMention: (filePath: string) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onSubmit: (prompt: string) => void;
}

export function NewThreadView({
  isChat = false,
  workspaces,
  selectedWorkspaceId,
  runtime,
  environment,
  prompt,
  attachments,
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
  onSetModel,
  onSetThinking,
  onSetCavemanLevel,
  onSetComposerMode,
  orchestratorMode,
  onToggleOrchestrator,
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
  const [draft, setDraft] = useState(prompt);
  const latestDraftRef = useRef(prompt);
  const lastPromptPropRef = useRef(prompt);
  const composerAutoGrowHeightRef = useRef(0);

  useEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  useEffect(() => {
    if (prompt === lastPromptPropRef.current) {
      return;
    }
    lastPromptPropRef.current = prompt;
    latestDraftRef.current = prompt;
    setDraft(prompt);
  }, [prompt]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onChangePrompt(latestDraftRef.current);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, onChangePrompt]);

  const handleDraftChange = (nextDraft: string) => {
    latestDraftRef.current = nextDraft;
    setDraft(nextDraft);
    if (showSlashMenu || showSlashOptionMenu || showMentionMenu || /(?:^|\s)[/@][^\s]*$/.test(nextDraft)) {
      onChangePrompt(nextDraft);
    }
  };

  const submitDraft = () => {
    onChangePrompt(draft);
    onSubmit(draft);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onComposerKeyDown(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!draft.trim() && attachments.length === 0) {
      return;
    }
    if (modelOnboarding.requiresModelSelection) {
      return;
    }

    playClick("down");
    submitDraft();
  };

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = "auto";
    const nextHeight = Math.min(composer.scrollHeight, 400);
    const previousHeight = composerAutoGrowHeightRef.current;
    if (Math.abs(nextHeight - previousHeight) < 1) {
      if (previousHeight > 0) {
        composer.style.height = `${previousHeight}px`;
      }
      return;
    }

    composerAutoGrowHeightRef.current = nextHeight;
    composer.style.height = `${nextHeight}px`;
  }, [composerRef, draft]);

  if (!isChat && !workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">New project</div>
          <h1>Open a folder to begin</h1>
          <p>Select a repository from the sidebar first, then start a local or worktree-backed project.</p>
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
          <div className="new-thread__eyebrow">{isChat ? "New chat" : "New project"}</div>
          <h1 className="new-thread__title">{isChat ? "What\u2019s up?" : "Let\u2019s build"}</h1>
        </div>

        {!isChat ? (
          <div className="new-thread__options">
            <div className="new-thread__option">
              <span className="new-thread__option-label">Project</span>
              <span className="new-thread__project-pill">
                <span className="new-thread__project-dot" aria-hidden="true" />
                <span className="new-thread__project-name">{workspace?.name ?? "\u2014"}</span>
                <ChevronDownIcon />
              </span>
            </div>
            <div className="new-thread__option">
              <span className="new-thread__option-label">Environment</span>
              <span className="new-thread__env-group">
                <button
                  className={`new-thread__env ${environment === "local" ? "new-thread__env--active" : ""}`}
                  type="button"
                  onClick={() => onSelectEnvironment("local")}
                >
                  <MonitorIcon />
                  <span>Local</span>
                </button>
                <button
                  className={`new-thread__env ${environment === "worktree" ? "new-thread__env--active" : ""}`}
                  type="button"
                  onClick={() => onSelectEnvironment("worktree")}
                >
                  <WorktreeIcon />
                  <span>Worktree</span>
                </button>
              </span>
            </div>
          </div>
        ) : null}

        <div className="new-thread__composer composer">
          {attachments.length > 0 ? (
            <div className="composer__attachment-shelf">
              <ComposerAttachments attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
            </div>
          ) : null}
          <div className="conversation conversation--composer">
            <ComposerSurface
              activeSlashCommand={activeSlashCommand}
              activeSlashCommandMeta={activeSlashCommandMeta}
              topNotice={(
                <ModelOnboardingNoticeBanner notice={modelOnboarding.notice} onOpenSettings={onOpenModelSettings} />
              )}
              composerDraft={draft}
              setComposerDraft={handleDraftChange}
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
              onComposerKeyDown={handleComposerKeyDown}
              onComposerPaste={onComposerPaste}
              onComposerDrop={onComposerDrop}
              onRemoveAttachment={onRemoveAttachment}
              onSelectSlashCommand={onSelectSlashCommand}
              onSelectSlashOption={onSelectSlashOption}
              showMentionMenu={showMentionMenu}
              mentionOptions={mentionOptions}
              selectedMentionIndex={selectedMentionIndex}
              onSelectMention={onSelectMention}
              textareaLabel="New project prompt"
              textareaTestId="new-thread-composer"
              textareaPlaceholder={composerMode === "plan" ? "Describe what you want to plan. Pi will grill you, write a PRD, then prepare Ralph." : " message the clanker"}
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
                  hasContent={Boolean(draft.trim() || attachments.length > 0)}
                  modelSelectorRef={modelSelectorRef}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                  onSetCavemanLevel={onSetCavemanLevel}
                  onSetComposerMode={onSetComposerMode}
                  orchestratorMode={orchestratorMode}
                  onToggleOrchestrator={onToggleOrchestrator}
                  onSubmit={submitDraft}
                />
              )}
            />
          </div>
        </div>
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
  readonly orchestratorMode?: boolean;
  readonly onToggleOrchestrator?: () => void;
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
  orchestratorMode,
  onToggleOrchestrator,
  onSubmit,
}: NewThreadComposerFooterProps) {
  const submitButtonSound = useButtonSound({ variant: "click", disabled: !hasContent || modelOnboarding.requiresModelSelection });
  return (
    <>
      <div className="composer__footer">
        <div className="composer__footer-row">
          <div className="composer__hint new-thread__hint">
            <span className="composer__hint-prose">Enter to send · Shift+Enter for newline</span>
            <ComposerControlRow
              runtime={runtime}
              provider={provider}
              modelId={modelId}
              thinkingLevel={thinkingLevel}
              cavemanLevel={cavemanLevel}
              composerMode={composerMode}
              modelSelectorRef={modelSelectorRef}
              dropdownPlacement="below"
              showEmptyModelControl
              unselectedModelLabel={modelOnboarding.unselectedModelLabel}
              emptyModelLabel={MODEL_OPTIONS_EMPTY_TITLE}
              emptyModelTitle={modelOnboarding.emptyModelTitle}
              onSetComposerMode={onSetComposerMode}
              onSetModel={onSetModel}
              onSetThinking={onSetThinking}
              onSetCavemanLevel={onSetCavemanLevel}
              orchestratorMode={orchestratorMode}
              onToggleOrchestrator={onToggleOrchestrator}
            />
          </div>

          <div className="composer__actions">
            <span className="composer__key-mount composer__key-mount--send">
              <button
                aria-label="Start project"
                className="button button--primary button--cta-icon composer__send"
                type="button"
                disabled={!hasContent || modelOnboarding.requiresModelSelection}
                {...submitButtonSound}
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
