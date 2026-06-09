import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerAttachment, ThreadLocation, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { BranchInfo } from "./ipc";
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
  readonly environment: ThreadLocation;
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
  readonly onSelectEnvironment: (environment: ThreadLocation) => void;
  readonly branches?: readonly BranchInfo[];
  readonly selectedBranch?: string;
  readonly onSelectBranch?: (branch: string) => void;
  readonly currentBranch?: string;
  readonly isDirty?: boolean;
  readonly existingWorktrees?: readonly WorktreeRecord[];
  readonly worktreeMode?: "new" | "existing";
  readonly onSelectWorktreeMode?: (mode: "new" | "existing") => void;
  readonly selectedExistingWorktreeId?: string;
  readonly onSelectExistingWorktree?: (worktreeId: string) => void;
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

function BranchGlyph({ dot = false }: { dot?: boolean }) {
  return (
    <svg className="branch-picker__glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="5.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 5v6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 8.5c0-2 1.5-3 4-3" stroke="currentColor" strokeWidth="1.3" />
      {dot ? <circle cx="6.6" cy="3" r="1.7" fill="#f5a623" /> : null}
    </svg>
  );
}

function BranchPicker({
  branches,
  selectedBranch,
  currentBranch,
  isDirty,
  onSelectBranch,
}: {
  readonly branches: readonly BranchInfo[];
  readonly selectedBranch: string;
  readonly currentBranch: string;
  readonly isDirty: boolean;
  readonly onSelectBranch: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = selectedBranch || currentBranch || "branch";
  const localStateLabel = currentBranch || "current";
  const select = (name: string) => {
    onSelectBranch(name);
    setOpen(false);
  };

  return (
    <div className="branch-picker" ref={rootRef}>
      <button
        className="branch-picker__trigger"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <BranchGlyph />
        <span className="branch-picker__trigger-label">{label}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="branch-picker__popover" role="menu">
          {currentBranch ? (
            <>
              <div className="branch-picker__section-label">Local file state</div>
              <button
                className={`branch-picker__item ${selectedBranch === currentBranch ? "branch-picker__item--active" : ""}`}
                type="button"
                role="menuitem"
                onClick={() => select(currentBranch)}
              >
                <BranchGlyph dot={isDirty} />
                <span className="branch-picker__item-text">
                  <span className="branch-picker__item-name">{localStateLabel}</span>
                  {isDirty ? (
                    <span className="branch-picker__item-sub">with local code changes</span>
                  ) : null}
                </span>
              </button>
            </>
          ) : null}
          <div className="branch-picker__section-label">Branches</div>
          {branches.map((b) => (
            <button
              key={b.name}
              className={`branch-picker__item ${selectedBranch === b.name ? "branch-picker__item--active" : ""}`}
              type="button"
              role="menuitem"
              onClick={() => select(b.name)}
            >
              <BranchGlyph />
              <span className="branch-picker__item-text">
                <span className="branch-picker__item-name">
                  {b.name}{b.isRemote ? " (remote)" : ""}
                </span>
              </span>
              {b.name === currentBranch ? <span className="branch-picker__check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  branches,
  selectedBranch,
  onSelectBranch,
  currentBranch,
  isDirty,
  existingWorktrees,
  worktreeMode,
  onSelectWorktreeMode,
  selectedExistingWorktreeId,
  onSelectExistingWorktree,
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

            {/* Worktree sub-options: new vs existing (only when Worktree env) */}
            {environment === "worktree" && existingWorktrees && existingWorktrees.length > 0 && onSelectWorktreeMode ? (
              <div className="new-thread__option">
                <span className="new-thread__option-label">Worktree</span>
                <span className="new-thread__env-group">
                  <button
                    className={`new-thread__env ${worktreeMode === "new" ? "new-thread__env--active" : ""}`}
                    type="button"
                    onClick={() => onSelectWorktreeMode("new")}
                  >
                    <span>New</span>
                  </button>
                  <button
                    className={`new-thread__env ${worktreeMode === "existing" ? "new-thread__env--active" : ""}`}
                    type="button"
                    onClick={() => onSelectWorktreeMode("existing")}
                  >
                    <span>Existing</span>
                  </button>
                </span>
              </div>
            ) : null}

            {/* Existing worktree picker */}
            {environment === "worktree" && worktreeMode === "existing" && existingWorktrees && onSelectExistingWorktree ? (
              <div className="new-thread__option">
                <span className="new-thread__option-label">Pick worktree</span>
                <select
                  className="new-thread__select"
                  value={selectedExistingWorktreeId || ""}
                  onChange={(e) => onSelectExistingWorktree(e.target.value)}
                >
                  {existingWorktrees.map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.name}{wt.branchName ? ` (${wt.branchName})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* Branch selector — always shown, independent of environment */}
            {branches && branches.length > 0 && onSelectBranch ? (
              <div className="new-thread__option">
                <span className="new-thread__option-label">Branch</span>
                <BranchPicker
                  branches={branches}
                  selectedBranch={selectedBranch || ""}
                  currentBranch={currentBranch || ""}
                  isDirty={isDirty ?? false}
                  onSelectBranch={onSelectBranch}
                />
              </div>
            ) : null}
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
                data-has-input={hasContent ? "" : undefined}
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
