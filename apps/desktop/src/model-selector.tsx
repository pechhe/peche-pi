import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { ReasoningMeter } from "./reasoning-meter";

export interface ModelSelectorHandle {
  openModelDropdown(): void;
}

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

type OpenDropdown = "none" | "model";

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function nextThinkingLevel(level: string): string {
  const index = THINKING_OPTIONS.findIndex((option) => option.value === level);
  if (index === -1) {
    return THINKING_OPTIONS[0]!.value;
  }
  return THINKING_OPTIONS[(index + 1) % THINKING_OPTIONS.length]!.value;
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  function ModelSelector(
    {
      runtime,
      provider,
      modelId,
      thinkingLevel,
      disabled,
      dropdownPlacement = "above",
      showEmptyModelControl = false,
      unselectedModelLabel = "Choose model",
      emptyModelLabel = "Choose model",
      emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
      onSetModel,
      onSetThinking,
    },
    ref,
  ) {
    const [open, setOpen] = useState<OpenDropdown>("none");
    const [modelFilter, setModelFilter] = useState("");
    const [hiddenModelKeys, setHiddenModelKeys] = useState<Set<string>>(new Set());
    const [showHiddenModels, setShowHiddenModels] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      openModelDropdown() {
        setOpen("model");
      },
    }));

    const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);

    const visibleModelOptions = useMemo(() => {
      if (showHiddenModels || hiddenModelKeys.size === 0) return modelOptions;
      return modelOptions.filter((m) => !hiddenModelKeys.has(modelKey(m.providerId, m.modelId)));
    }, [modelOptions, hiddenModelKeys, showHiddenModels]);

    const filteredModels = useMemo(() => {
      if (!modelFilter) return visibleModelOptions;
      const q = modelFilter.toLowerCase();
      return visibleModelOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.description.toLowerCase().includes(q) ||
          opt.providerId.toLowerCase().includes(q),
      );
    }, [visibleModelOptions, modelFilter]);

    const groupedModels = useMemo(() => groupByProvider(filteredModels), [filteredModels]);
    const hasAvailableModelOptions = modelOptions.length > 0;
    const hasModelControl = Boolean(provider && modelId) || hasAvailableModelOptions;
    const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
    const activeModelLabel = useMemo(() => {
      if (!provider || !modelId) return undefined;
      return modelOptions.find(
        (m) => m.providerId === provider && m.modelId === modelId,
      )?.label;
    }, [modelOptions, provider, modelId]);
    const modelBadgeLabel =
      provider && modelId
        ? (activeModelLabel ?? `${provider}:${modelId}`)
        : hasAvailableModelOptions
          ? unselectedModelLabel
          : emptyModelLabel;
    const noMatchingModels =
      hasAvailableModelOptions && modelFilter.trim().length > 0 && groupedModels.length === 0;

    const handleHideModel = (m: ComposerModelOption) => {
      setHiddenModelKeys((prev) => new Set([...prev, modelKey(m.providerId, m.modelId)]));
    };

    const handleUnhideAll = () => {
      setHiddenModelKeys(new Set());
      setShowHiddenModels(false);
    };

    const handleSelectModel = (option: ComposerModelOption) => {
      if (option.providerId !== provider || option.modelId !== modelId) {
        onSetModel(option.providerId, option.modelId);
      }
      setOpen("none");
    };

    const handleDropdownKeyDown = (event: React.KeyboardEvent) => {
      if (event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        event.stopPropagation();
        const index = parseInt(event.key) - 1;
        const items = groupedModels.flatMap((g) => g.items);
        if (index < items.length && items[index]) {
          handleSelectModel(items[index]);
        }
      }
    };

    useEffect(() => {
      if (open === "none") {
        setModelFilter("");
        setShowHiddenModels(false);
        return undefined;
      }

      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setOpen("none");
        }
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setOpen("none");
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [open]);

    if (!shouldRenderModelControl && !thinkingLevel) {
      return null;
    }

    const flatFiltered = filteredModels;
    const hiddenCount = modelOptions.length - visibleModelOptions.length;

    return (
      <span className="model-selector" ref={containerRef}>
        {shouldRenderModelControl ? (
          <span className="model-selector__anchor">
            <button
              className="model-selector__badge"
              type="button"
              disabled={disabled}
              onClick={() => setOpen(open === "model" ? "none" : "model")}
            >
              {modelBadgeLabel}
            </button>
            {open === "model" ? (
              <div
                className={`model-selector__dropdown ${dropdownPlacement === "below" ? "model-selector__dropdown--below" : ""}`}
                onWheel={(event) => event.stopPropagation()}
                onKeyDown={handleDropdownKeyDown}
              >
                <div className="model-selector__filter">
                  <input
                    className="model-selector__filter-input"
                    placeholder="Filter models..."
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    autoFocus
                  />
                </div>
                {groupedModels.map((group, groupIdx) => {
                  let itemNumber = 1;
                  // Count items in previous groups for flat index
                  for (let i = 0; i < groupIdx; i++) {
                    itemNumber += groupedModels[i]!.items.length;
                  }

                  return (
                    <div key={group.provider}>
                      <div className="model-selector__group-title">{group.provider}</div>
                      {group.items.map((option, itemIdx) => {
                        const number = itemNumber + itemIdx;
                        const isActive = option.providerId === provider && option.modelId === modelId;
                        return (
                          <button
                            className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                            key={modelKey(option.providerId, option.modelId)}
                            type="button"
                            onClick={() => handleSelectModel(option)}
                          >
                            <span className="model-selector__item-number">
                              {number <= 9 ? number : ""}
                            </span>
                            <span className="model-selector__item-label">{option.label}</span>
                            {isActive ? (
                              <span className="model-selector__item-meta">active</span>
                            ) : null}
                            <button
                              className="model-selector__item-hide"
                              type="button"
                              tabIndex={-1}
                              title="Hide from picker"
                              aria-label="Hide model"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHideModel(option);
                              }}
                            >
                              <HideIcon />
                            </button>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {groupedModels.length === 0 ? (
                  <>
                    <div className="model-selector__group-title">
                      {noMatchingModels ? "No matching models" : emptyModelTitle}
                    </div>
                    {noMatchingModels ? <div className="model-selector__empty">Try a different filter.</div> : null}
                  </>
                ) : null}
                {(hiddenCount > 0 || showHiddenModels) ? (
                  <button
                    className="model-selector__show-hidden"
                    type="button"
                    onClick={() => {
                      if (showHiddenModels) {
                        handleUnhideAll();
                      } else {
                        setShowHiddenModels(true);
                      }
                    }}
                  >
                    {showHiddenModels ? `Hide all` : `Show hidden (${hiddenCount})`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </span>
        ) : null}
        {thinkingLevel ? (
          <span className="model-selector__anchor">
            <button
              className="model-selector__badge"
              type="button"
              disabled={disabled}
              title="Thinking level (click to cycle)"
              onClick={() => onSetThinking(nextThinkingLevel(thinkingLevel))}
            >
              <ReasoningMeter level={thinkingLevel} size={12} />
            </button>
          </span>
        ) : null}
      </span>
    );
  },
);

function HideIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

interface ModelGroup {
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
}

function groupByProvider(options: readonly ComposerModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of options) {
    const existing = groups.get(option.providerId);
    if (existing) {
      existing.push(option);
    } else {
      groups.set(option.providerId, [option]);
    }
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}
