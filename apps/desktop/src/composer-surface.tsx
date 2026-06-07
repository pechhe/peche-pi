import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { ComposerAttachment } from "./desktop-state";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { hasFilesInDataTransfer } from "./composer-attachments";
import { FileIcon, ModelIcon, ReasoningIcon, SettingsIcon, SkillIcon, SparkIcon, StatusIcon } from "./icons";
import { openImageLightbox } from "./image-lightbox";
import { playButtonClick } from "./button-click-sound";

interface ComposerSurfaceProps {
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly topNotice?: ReactNode;
  readonly composerDraft: string;
  readonly setComposerDraft: (draft: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly attachments: readonly ComposerAttachment[];

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
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly textareaLabel: string;
  readonly textareaTestId: string;
  readonly textareaPlaceholder: string;
  readonly textareaClassName?: string;
  readonly screenContent?: ReactNode;
  readonly screenFooter?: ReactNode;
  readonly footer: ReactNode;
}

export function ComposerAttachments({
  attachments,
  onRemoveAttachment,
}: {
  readonly attachments: readonly ComposerAttachment[];
  readonly onRemoveAttachment: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="composer__attachments">
      {attachments.map((attachment) => (
        <div className={`composer-attachment composer-attachment--${attachment.kind} ${attachment.kind === "image" ? "composer-attachment--tile" : ""}`} key={attachment.id}>
          {attachment.kind === "image" ? (
            <div className="composer-attachment__tile">
              <button
                type="button"
                className="composer-attachment__preview-button"
                aria-label={`View ${attachment.name}`}
                onClick={() =>
                  openImageLightbox({
                    src: `data:${attachment.mimeType};base64,${attachment.data}`,
                    alt: attachment.name,
                  })
                }
              >
                <img
                  alt={attachment.name}
                  className="composer-attachment__preview"
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              </button>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="composer-attachment__remove"
                type="button"
                onClick={() => { playButtonClick(); onRemoveAttachment(attachment.id); }}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <span className="composer-attachment__icon" aria-hidden="true">
                <FileIcon />
              </span>
              <span className="composer-attachment__name">{attachment.name}</span>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="composer-attachment__remove"
                type="button"
                onClick={() => { playButtonClick(); onRemoveAttachment(attachment.id); }}
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function ComposerSurface({
  activeSlashCommand,
  activeSlashCommandMeta,
  topNotice,
  composerDraft,
  setComposerDraft,
  composerRef,
  attachments: _attachments,
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
  onRemoveAttachment: _onRemoveAttachment,
  onSelectSlashCommand,
  onSelectSlashOption,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  textareaLabel,
  textareaTestId,
  textareaPlaceholder,
  textareaClassName,
  screenContent,
  screenFooter,
  footer,
}: ComposerSurfaceProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const clearDragState = () => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (_event: DragEvent<HTMLDivElement>) => {
    if (!isDragActive) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    clearDragState();
    onComposerDrop(event);
  };

  // Clicking anywhere in the empty screen area (the gap below the text,
  // above the controls) should land the cursor in the textarea. Without
  // this, clicks on the editor padding/gap do nothing.
  const handleEditorMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, .composer__bar")) {
      return;
    }
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }
    event.preventDefault();
    textarea.focus();
    const caret = textarea.value.length;
    textarea.setSelectionRange(caret, caret);
  };

  return (
    <div
      className={`composer__surface ${isDragActive ? "composer__surface--drag-active" : ""}`}
      data-testid={`${textareaTestId}-surface`}
      onPaste={onComposerPaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragActive ? (
        <div className="composer__drop-indicator" data-testid="composer-drop-indicator">
          Drop images or files to attach
        </div>
      ) : null}
      {activeSlashCommand ? (
        <div className="composer__slash-intent">
          <span className="composer__slash-intent-icon" aria-hidden="true">
            <SlashCommandIcon command={activeSlashCommand} />
          </span>
          <span className="composer__slash-intent-body">
            <span className="composer__slash-intent-title">{activeSlashCommand.title}</span>
            {activeSlashCommandMeta ? (
              <span className="composer__slash-intent-meta">{activeSlashCommandMeta}</span>
            ) : null}
          </span>
          <button
            aria-label={`Clear ${activeSlashCommand.title}`}
            className="composer__slash-intent-clear"
            type="button"
            onClick={() => { playButtonClick(); onClearSlashCommand(); }}
          >
            ×
          </button>
        </div>
      ) : null}
      {showSlashMenu || (showSlashOptionMenu && selectedSlashCommand) ? (
        <div className="composer__slash-panel" data-testid="composer-slash-panel" onWheel={(event) => event.stopPropagation()}>
          {showSlashMenu ? (
            <div className="slash-menu" data-testid="slash-menu">
              {slashSections.map((section) => (
                <div className="slash-menu__section" key={section.id}>
                  {section.title ? (
                    <div className={`slash-menu__section-title slash-menu__section-title--${section.id}`}>
                      <span className="slash-menu__section-icon" aria-hidden="true">
                        {section.id === "runtime" ? <SparkIcon /> : <SettingsIcon />}
                      </span>
                      <span>{section.title}</span>
                    </div>
                  ) : null}
                  {section.items.map((command) => (
                    <button
                      className={`slash-menu__item ${command.section === "runtime" ? "slash-menu__item--skill" : ""} ${selectedSlashCommand?.id === command.id ? "slash-menu__item--active" : ""}`}
                      key={command.id}
                      type="button"
                      onClick={() => { playButtonClick(); onSelectSlashCommand(command); }}
                    >
                      <span className="slash-menu__icon" aria-hidden="true">
                        <SlashCommandIcon command={command} />
                      </span>
                      {command.section === "runtime" ? (
                        <span className="slash-menu__content slash-menu__content--skill">
                          <span className="slash-menu__line">
                            <span className="slash-menu__title">{command.title}</span>
                            {command.sourceLabel ? <span className="slash-menu__skill-badge">{command.sourceLabel}</span> : null}
                            {command.compatibility?.status === "terminal-only" ? (
                              <span className="slash-menu__skill-badge slash-menu__skill-badge--warning">Terminal-only</span>
                            ) : null}
                          </span>
                          <span className="slash-menu__description">{command.description}</span>
                          <span className="slash-menu__meta">
                            <span className="slash-menu__command slash-menu__command--skill">{command.command}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="slash-menu__content">
                          <span className="slash-menu__line">
                            <span className="slash-menu__title">{command.title}</span>
                            <span className="slash-menu__command">{command.command}</span>
                          </span>
                          <span className="slash-menu__description">{command.description}</span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {showSlashOptionMenu && selectedSlashCommand ? (
            <div className="slash-menu slash-menu--options" data-testid="slash-options-menu">
              <div className="slash-menu__search">{selectedSlashCommand.title}</div>
              {slashOptions.length > 0
                ? slashOptions.map((option) => (
                    <button
                      className={`slash-menu__option ${selectedSlashOption?.value === option.value ? "slash-menu__option--active" : ""}`}
                      key={option.value}
                      type="button"
                      onClick={() => { playButtonClick(); onSelectSlashOption(option); }}
                    >
                      <span className="slash-menu__option-title">{option.label}</span>
                      <span className="slash-menu__option-description">{option.description}</span>
                    </button>
                  ))
                : slashOptionEmptyState ? (
                    <div className="slash-menu__empty">
                      <div className="slash-menu__empty-title">{slashOptionEmptyState.title}</div>
                      <div className="slash-menu__empty-description">{slashOptionEmptyState.description}</div>
                    </div>
                  ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="composer__editor" onMouseDown={handleEditorMouseDown}>
        <div className="composer__screen">
          {topNotice}
          {showMentionMenu ? (
            <div className="composer__menus">
            <div className="mention-menu" data-testid="mention-menu" onWheel={(event) => event.stopPropagation()}>
              {mentionOptions.map((filePath, index) => {
                const lastSlash = filePath.lastIndexOf("/");
                const dirPart = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : "";
                const namePart = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
                return (
                  <button
                    className={`mention-menu__item ${index === selectedMentionIndex ? "mention-menu__item--active" : ""}`}
                    key={filePath}
                    type="button"
                    onClick={() => { playButtonClick(); onSelectMention(filePath); }}
                  >
                    {dirPart ? <span className="mention-menu__dirname">{dirPart}</span> : null}
                    <span className="mention-menu__filename">{namePart}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
          {screenContent ?? (
            <>
              <textarea
                aria-label={textareaLabel}
                className={textareaClassName}
                data-testid={textareaTestId}
                ref={composerRef}
                value={composerDraft}
                onChange={(event) => {
                  setComposerDraft(event.target.value);
                }}
                onKeyDown={onComposerKeyDown}
                placeholder={textareaPlaceholder}
              />
              {screenFooter}
            </>
          )}
        </div>
        <div className="composer__bar">{footer}</div>
      </div>
    </div>
  );
}

function SlashCommandIcon({ command }: { readonly command: ComposerSlashCommand }) {
  switch (command.kind) {
    case "runtime":
      return command.runtimeCommand?.source === "skill" ? <SkillIcon /> : <SparkIcon />;
    case "model":
      return <ModelIcon />;
    case "thinking":
      return <ReasoningIcon />;
    case "status":
      return <StatusIcon />;
    default:
      return <SparkIcon />;
  }
}
