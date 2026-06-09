import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_TITLE,
  type ComposerModelOption,
} from "./composer-commands";
import { ReasoningMeter } from "./reasoning-meter";
import { ShortcutHint } from "./shortcut-hint";
import { useButtonSound } from "./use-button-sound";

export interface ModelSelectorHandle {
  openModelDropdown(): void;
  selectSliderSlot(index: number): void;
  cycleThinkingLevel(direction: -1 | 1): void;
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

function nextThinkingLevel(level: string, availableLevels: readonly string[]): string {
  // Cycle through every level the model supports (in canonical dial order),
  // including "off", so each slot the dial renders is reachable.
  if (availableLevels.length === 0) return "off";
  const index = availableLevels.indexOf(level);
  if (index === -1) return availableLevels[0]!;
  return availableLevels[(index + 1) % availableLevels.length]!;
}

function shortModelLabel(label: string): string {
  return label
    .replace(/^claude\s+/i, "Claude ")
    .replace(/^gpt-?5/i, "GPT-5")
    .replace(/\s+/g, " ")
    .trim();
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
      unselectedModelLabel: _unselectedModelLabel = "Choose model",
      emptyModelLabel: _emptyModelLabel = "Choose model",
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
    const [pinnedModelKeys, setPinnedModelKeys] = useState<readonly string[]>([]);
    const [visualModelKey, setVisualModelKey] = useState<string | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const pendingModelFrameRef = useRef<number | undefined>(undefined);
    const rotarySound = useButtonSound({ variant: "rotary", disabled });

    useImperativeHandle(ref, () => ({
      openModelDropdown() {
        setOpen("model");
      },
      selectSliderSlot(index: number) {
        const option = sliderOptions[index];
        if (option) handleSelectModel(option);
      },
      cycleThinkingLevel(direction: -1 | 1) {
        if (!thinkingLevel) return;
        // Cycle the full set the model supports (off/minimal included), in the
        // same canonical order the dial uses.
        if (availableThinkingLevels.length === 0) return;
        const currentIndex = availableThinkingLevels.indexOf(thinkingLevel);
        const nextIndex = currentIndex >= 0
          ? (currentIndex + direction + availableThinkingLevels.length) % availableThinkingLevels.length
          : direction > 0 ? 0 : availableThinkingLevels.length - 1;
        const next = availableThinkingLevels[nextIndex];
        if (next) onSetThinking(next);
      },
    }));

    const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);

    // Resolve the effective model record so the dial only ever offers levels the
    // model actually supports. When no explicit provider/modelId is set (session
    // is on the default model), fall back to the runtime's default model rather
    // than inventing all six levels — otherwise unsupported levels (e.g. off,
    // minimal) appear as phantom slots that the session clamp immediately rejects.
    const effectiveModelRecord = useMemo(() => {
      if (!runtime) return undefined;
      const p = provider ?? runtime.settings.defaultProvider;
      const m = modelId ?? runtime.settings.defaultModelId;
      if (!p || !m) return undefined;
      return runtime.models.find((record) => record.providerId === p && record.modelId === m);
    }, [runtime, provider, modelId]);

    // When the model is explicitly selected but not found in the registry (e.g.
    // custom model not yet loaded), use the default model's levels instead of
    // the old ["off"] fallback which showed a phantom "off" slot for models
    // that don't support it.
    const fallbackModelRecord = useMemo(() => {
      if (!runtime) return undefined;
      const dp = runtime.settings.defaultProvider;
      const dm = runtime.settings.defaultModelId;
      if (!dp || !dm) return undefined;
      return runtime.models.find((record) => record.providerId === dp && record.modelId === dm);
    }, [runtime]);

    const availableThinkingLevels =
      effectiveModelRecord?.availableThinkingLevels ??
      fallbackModelRecord?.availableThinkingLevels ??
      ["off"];

    // Provider-specific display names (e.g. xhigh shows as "MAX" for Opus,
    // "XHIGH" for GPT-5.5) so the dial matches the selected model.
    const thinkingLevelLabels = effectiveModelRecord?.thinkingLevelLabels ?? fallbackModelRecord?.thinkingLevelLabels;

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
    const _activeModelLabel = useMemo(() => {
      if (!provider || !modelId) return undefined;
      return modelOptions.find(
        (m) => m.providerId === provider && m.modelId === modelId,
      )?.label;
    }, [modelOptions, provider, modelId]);

    const pinnedModelOptions = useMemo(() => {
      const byKey = new Map(modelOptions.map((option) => [modelKey(option.providerId, option.modelId), option]));
      const picked = pinnedModelKeys
        .map((key) => byKey.get(key))
        .filter((option): option is ComposerModelOption => Boolean(option));
      for (const option of modelOptions) {
        if (picked.length >= 3) break;
        if (!picked.some((p) => p.providerId === option.providerId && p.modelId === option.modelId)) {
          picked.push(option);
        }
      }
      return picked.slice(0, 3);
    }, [modelOptions, pinnedModelKeys]);
    const activeKey = visualModelKey ?? (provider && modelId ? modelKey(provider, modelId) : undefined);
    const overflowModelOption = useMemo(() => {
      if (!activeKey || pinnedModelOptions.some((m) => modelKey(m.providerId, m.modelId) === activeKey)) return undefined;
      return modelOptions.find((m) => modelKey(m.providerId, m.modelId) === activeKey);
    }, [activeKey, modelOptions, pinnedModelOptions]);
    const sliderOptions = overflowModelOption ? [...pinnedModelOptions, overflowModelOption] : pinnedModelOptions;
    const activeSliderIndex = sliderOptions.findIndex((m) => modelKey(m.providerId, m.modelId) === activeKey);
    const sliderPosition = activeSliderIndex >= 0 ? activeSliderIndex : 1;
    const noMatchingModels =
      hasAvailableModelOptions && modelFilter.trim().length > 0 && groupedModels.length === 0;

    const handleHideModel = (m: ComposerModelOption) => {
      setHiddenModelKeys((prev) => new Set([...prev, modelKey(m.providerId, m.modelId)]));
    };

    const handleUnhideAll = () => {
      setHiddenModelKeys(new Set());
      setShowHiddenModels(false);
    };

    const pinModelOut = (option: ComposerModelOption, replaceIndex = sliderPosition) => {
      const key = modelKey(option.providerId, option.modelId);
      setPinnedModelKeys((prev) => {
        if (prev.includes(key)) return prev;
        const next = pinnedModelOptions.map((p) => modelKey(p.providerId, p.modelId));
        next[Math.max(0, Math.min(2, replaceIndex))] = key;
        return next;
      });
    };

    const restoreComposerFocus = () => {
      const textarea = containerRef.current
        ?.closest(".composer__surface")
        ?.querySelector<HTMLTextAreaElement>("textarea");
      textarea?.focus();
    };

    const handleSelectModel = (option: ComposerModelOption, pinToOut = false) => {
      const key = modelKey(option.providerId, option.modelId);
      const optionSliderIndex = pinnedModelOptions.findIndex((m) => modelKey(m.providerId, m.modelId) === key);
      if (pinToOut && optionSliderIndex === -1) {
        pinModelOut(option);
      }
      setVisualModelKey(key);
      setOpen("none");
      // Dropdown autoFocus stole focus from the composer; hand it back so the
      // user can keep typing after picking a model. rAF runs after the dropdown
      // unmounts, otherwise focus lands on the about-to-be-removed input.
      window.requestAnimationFrame(restoreComposerFocus);

      if (option.providerId === provider && option.modelId === modelId) return;

      if (pendingModelFrameRef.current !== undefined) {
        window.cancelAnimationFrame(pendingModelFrameRef.current);
      }
      pendingModelFrameRef.current = window.requestAnimationFrame(() => {
        pendingModelFrameRef.current = undefined;
        onSetModel(option.providerId, option.modelId);
      });
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
      if (pinnedModelKeys.length === 0 && modelOptions.length > 0) {
        setPinnedModelKeys(modelOptions.slice(0, 3).map((option) => modelKey(option.providerId, option.modelId)));
      }
    }, [modelOptions, pinnedModelKeys.length]);

    useEffect(() => {
      return () => {
        if (pendingModelFrameRef.current !== undefined) {
          window.cancelAnimationFrame(pendingModelFrameRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (visualModelKey && provider && modelId && visualModelKey === modelKey(provider, modelId)) {
        setVisualModelKey(undefined);
      }
    }, [visualModelKey, provider, modelId]);

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

    const _flatFiltered = filteredModels;
    const hiddenCount = modelOptions.length - visibleModelOptions.length;

    return (
      <span className="model-selector" ref={containerRef}>
        {shouldRenderModelControl ? (
          <span className="model-selector__anchor" data-section-label="Model">
            <span className="composer__key-mount">
              <ShortcutHint keys="⌘1–4" />
              <span
                className="model-selector__badge model-selector__badge--slider"
                data-physical-key="model"
                aria-expanded={open === "model"}
                style={{ "--model-slider-position": `${sliderPosition}` } as CSSProperties}
              >
                <span className="model-selector__slider" aria-hidden="true">
                  <span className="model-selector__slider-ticks">
                    <span className="model-selector__slider-tick model-selector__slider-tick--0" />
                    <span className="model-selector__slider-tick model-selector__slider-tick--1" />
                    <span className="model-selector__slider-tick model-selector__slider-tick--2" />
                    <span className="model-selector__slider-tick model-selector__slider-tick--3" />
                  </span>
                  <span className="model-selector__slider-track">
                    <span className="model-selector__slider-rail" />
                    <span className="model-selector__slider-glow" />
                  </span>
                  <span className="model-selector__slider-thumb" />
                </span>
                {sliderOptions.map((option, index) => {
                  const isActive = modelKey(option.providerId, option.modelId) === activeKey;
                  return (
                    <button
                      className={`model-selector__slider-label model-selector__slider-label--slot model-selector__slider-label--slot-${index}${isActive ? " model-selector__slider-label--selected" : ""}`}
                      type="button"
                      key={modelKey(option.providerId, option.modelId)}
                      disabled={disabled}
                      title={`Switch to ${option.label}`}
                      {...rotarySound}
                      onClick={() => {
                        if (index === 3 && isActive) {
                          setOpen(open === "model" ? "none" : "model");
                        } else {
                          handleSelectModel(option);
                        }
                      }}
                    >
                      {shortModelLabel(option.label)}
                    </button>
                  );
                })}
                {sliderOptions.length < 4 ? (
                  <button
                    className="model-selector__slider-label model-selector__slider-label--slot model-selector__slider-label--slot-3 model-selector__slider-label--menu"
                    type="button"
                    disabled={disabled}
                    aria-label="Open full model menu"
                    aria-expanded={open === "model"}
                    {...rotarySound}
                    onClick={() => setOpen(open === "model" ? "none" : "model")}
                  >
                    …
                  </button>
                ) : null}
              </span>
            </span>
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
                            <span className="model-selector__item-actions" onClick={(e) => e.stopPropagation()}>
                              {[0, 1, 2].map((slot) => (
                                <button
                                  className="model-selector__item-slot"
                                  type="button"
                                  tabIndex={-1}
                                  key={slot}
                                  title={`Keep in position ${slot + 1}`}
                                  aria-label={`Keep model in slider position ${slot + 1}`}
                                  onClick={() => pinModelOut(option, slot)}
                                >
                                  {slot + 1}
                                </button>
                              ))}
                              <button
                                className="model-selector__item-hide"
                                type="button"
                                tabIndex={-1}
                                title="Hide from model menu"
                                aria-label="Hide model from menu"
                                onClick={() => handleHideModel(option)}
                              >
                                hide
                              </button>
                            </span>
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
          <span className="model-selector__anchor" data-section-label="Reasoning">
            <span className="composer__key-mount composer__key-mount--reasoning">
              <ShortcutHint keys="⌘↑↓" />
              <button
                className="model-selector__badge model-selector__badge--reasoning"
                type="button"
                data-physical-key="thinking"
                disabled={disabled}
                title="Thinking level (click to cycle)"
                {...rotarySound}
                onClick={() => onSetThinking(nextThinkingLevel(thinkingLevel, availableThinkingLevels))}
              >
                <ReasoningMeter level={thinkingLevel} availableLevels={availableThinkingLevels} levelLabels={thinkingLevelLabels} size={12} />
              </button>
            </span>
          </span>
        ) : null}
      </span>
    );
  },
);

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
