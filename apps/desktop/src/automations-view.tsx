import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  Automation,
  AutomationFrequency,
  AutomationSchedule,
  ThreadLocation,
  WorkspaceRecord,
} from "./desktop-state";
import { automationScheduleLabel } from "./desktop-state";
import { buildModelOptions, type ComposerModelOption } from "./composer-commands";
import {
  AutomationIcon,
  AutomationRunIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  ComposeIcon,
  ModelIcon,
  MonitorIcon,
  ProjectIcon,
  ReasoningIcon,
  SettingsIcon,
  WorktreeIcon,
} from "./icons";
import { playButtonClick, playButtonSecondary } from "./button-click-sound";
import { formatRelativeTime } from "./string-utils";

interface AutomationsViewProps {
  readonly automations: readonly Automation[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly filterWorkspaceId?: string;
  /** Last-used project; pre-selected for new automations. */
  readonly defaultWorkspaceId?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly onCreateAutomation: (input: CreateAutomationInput) => void;
  readonly onUpdateAutomation: (id: string, patch: Partial<Automation>) => void;
  readonly onDeleteAutomation: (id: string) => void;
  readonly onFireNow: (id: string) => void;
  readonly onClearFilter: () => void;
  readonly onSelectSession: (workspaceId: string, sessionId: string) => void;
}

export interface CreateAutomationInput {
  name?: string;
  prompt: string;
  schedule: AutomationSchedule;
  workspaceId: string;
  environment: ThreadLocation;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  enabled?: boolean;
}

export function AutomationsView({
  automations,
  workspaces,
  filterWorkspaceId,
  defaultWorkspaceId,
  runtime,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onFireNow,
  onClearFilter,
}: AutomationsViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();

  const filteredAutomations = useMemo(() => {
    if (!filterWorkspaceId) return automations;
    return automations.filter((a) => a.workspaceId === filterWorkspaceId);
  }, [automations, filterWorkspaceId]);

  const filterWorkspace = filterWorkspaceId
    ? workspaces.find((w) => w.id === filterWorkspaceId)
    : undefined;

  const editingAutomation = editingId
    ? automations.find((a) => a.id === editingId)
    : undefined;

  return (
    <div className="automations-view">
      <div className="automations-view__header">
        <div className="automations-view__title-row">
          <AutomationIcon />
          <h1>Automations</h1>
          {filterWorkspace ? (
            <span className="automations-view__filter-badge">
              {filterWorkspace.name}
              <button
                className="automations-view__filter-clear"
                type="button"
                onClick={() => { playButtonSecondary(); onClearFilter(); }}
              >
                ×
              </button>
            </span>
          ) : null}
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => { playButtonClick(); setShowCreateForm(true); setEditingId(undefined); }}
        >
          <ComposeIcon /> New automation
        </button>
      </div>

      {showCreateForm || editingAutomation ? (
        <AutomationForm
          workspaces={workspaces}
          runtime={runtime}
          initial={editingAutomation}
          defaultWorkspaceId={filterWorkspaceId ?? defaultWorkspaceId}
          onSubmit={(input) => {
            if (editingAutomation) {
              onUpdateAutomation(editingAutomation.id, input);
            } else {
              onCreateAutomation(input);
            }
            setShowCreateForm(false);
            setEditingId(undefined);
          }}
          onCancel={() => { setShowCreateForm(false); setEditingId(undefined); }}
        />
      ) : null}

      {filteredAutomations.length === 0 && !showCreateForm ? (
        <div className="automations-view__empty">
          <AutomationIcon />
          <h2>No automations yet</h2>
          <p>
            {filterWorkspace
              ? `No automations for ${filterWorkspace.name}. Create one to schedule recurring tasks.`
              : "Create an automation to schedule recurring tasks that run as new threads."}
          </p>
        </div>
      ) : (
        <div className="automations-view__list">
          {filteredAutomations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              workspace={workspaces.find((w) => w.id === automation.workspaceId)}
              onEdit={() => { playButtonClick(); setEditingId(automation.id); setShowCreateForm(false); }}
              onToggleEnabled={() =>
                onUpdateAutomation(automation.id, { enabled: !automation.enabled })
              }
              onDelete={() => onDeleteAutomation(automation.id)}
              onFireNow={() => onFireNow(automation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Automation card ─────────────────────────────────── */

interface AutomationCardProps {
  readonly automation: Automation;
  readonly workspace?: WorkspaceRecord;
  readonly onEdit: () => void;
  readonly onToggleEnabled: () => void;
  readonly onDelete: () => void;
  readonly onFireNow: () => void;
}

function AutomationCard({
  automation,
  workspace,
  onEdit,
  onToggleEnabled,
  onDelete,
  onFireNow,
}: AutomationCardProps) {
  return (
    <div className={`automation-card ${automation.enabled ? "" : "automation-card--disabled"}`}>
      <div className="automation-card__header">
        <div className="automation-card__title-row">
          <AutomationRunIcon />
          <span className="automation-card__name">{automation.name}</span>
          {workspace ? (
            <span className="automation-card__workspace">{workspace.name}</span>
          ) : null}
        </div>
        <div className="automation-card__actions">
          <button
            className={`icon-button automation-card__toggle ${automation.enabled ? "automation-card__toggle--on" : ""}`}
            type="button"
            title={automation.enabled ? "Disable" : "Enable"}
            onClick={onToggleEnabled}
          >
            <span className="automation-card__toggle-dot" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Run now"
            onClick={onFireNow}
          >
            ▶
          </button>
          <button
            className="icon-button"
            type="button"
            title="Edit"
            onClick={onEdit}
          >
            <SettingsIcon />
          </button>
          <button
            className="icon-button icon-button--danger"
            type="button"
            title="Delete"
            onClick={onDelete}
          >
            ×
          </button>
        </div>
      </div>
      <div className="automation-card__meta">
        <span className="automation-card__schedule">
          {automationScheduleLabel(automation.schedule)}
        </span>
        {automation.model ? (
          <span className="automation-card__model">
            {automation.model.modelId}
          </span>
        ) : null}
        {automation.lastRunAt ? (
          <span className="automation-card__last-run">
            Last run {formatRelativeTime(automation.lastRunAt)}
          </span>
        ) : (
          <span className="automation-card__last-run automation-card__last-run--never">
            Never run
          </span>
        )}
      </div>
      <div className="automation-card__prompt">{automation.prompt}</div>
    </div>
  );
}


/* ── Create / Edit builder (Codex-style floating card) ─── */

interface AutomationFormProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly runtime?: RuntimeSnapshot;
  readonly initial?: Automation;
  readonly defaultWorkspaceId?: string;
  readonly onSubmit: (input: CreateAutomationInput) => void;
  readonly onCancel: () => void;
}

type OpenMenu = "none" | "env" | "project" | "schedule" | "model" | "reasoning";

const FREQUENCY_OPTIONS: { value: AutomationFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const TIME_OPTIONS = ["09:00", "13:00", "17:00"] as const;

function AutomationForm({
  workspaces,
  runtime,
  initial,
  defaultWorkspaceId,
  onSubmit,
  onCancel,
}: AutomationFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [environment, setEnvironment] = useState<ThreadLocation>(initial?.environment ?? "worktree");
  const [workspaceId, setWorkspaceId] = useState(
    initial?.workspaceId ?? defaultWorkspaceId ?? (workspaces[0]?.id ?? ""),
  );
  const [frequency, setFrequency] = useState<AutomationFrequency>(initial?.schedule.frequency ?? "daily");
  const [time, setTime] = useState(initial?.schedule.time ?? "09:00");
  const [selectedProvider, setSelectedProvider] = useState(initial?.model?.provider ?? "");
  const [selectedModelId, setSelectedModelId] = useState(initial?.model?.modelId ?? "");
  const [thinkingLevel, setThinkingLevel] = useState(initial?.thinkingLevel ?? "");
  const [openMenu, setOpenMenu] = useState<OpenMenu>("none");
  const [modelFilter, setModelFilter] = useState("");
  const barRef = useRef<HTMLDivElement>(null);
  const modelPillRef = useRef<HTMLButtonElement>(null);
  const [modelMenuStyle, setModelMenuStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (openMenu === "none") return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu("none");
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu("none"); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [openMenu]);

  const allModels = runtime?.models ?? [];
  // Same scoped set the composer offers (available + enabled patterns).
  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);
  const selectedModelRecord = allModels.find(
    (m) => m.providerId === selectedProvider && m.modelId === selectedModelId,
  );
  const thinkingLevels = selectedModelRecord?.availableThinkingLevels ?? [];
  const thinkingLabels = selectedModelRecord?.thinkingLevelLabels ?? {};

  const filteredModels = useMemo(() => {
    if (!modelFilter) return modelOptions;
    const q = modelFilter.toLowerCase();
    return modelOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q) ||
        opt.providerId.toLowerCase().includes(q),
    );
  }, [modelOptions, modelFilter]);

  const filteredGroupedModels = useMemo(() => {
    const groups = new Map<string, ComposerModelOption[]>();
    for (const opt of filteredModels) {
      const existing = groups.get(opt.providerId);
      if (existing) existing.push(opt);
      else groups.set(opt.providerId, [opt]);
    }
    return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
  }, [filteredModels]);

  const schedule: AutomationSchedule = { frequency, time };
  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId);
  const canCreate = prompt.trim().length > 0 && Boolean(workspaceId);

  const selectModel = (providerId: string, modelId: string, levels: readonly string[]) => {
    setSelectedProvider(providerId);
    setSelectedModelId(modelId);
    setThinkingLevel(levels.length > 0 ? (levels[0] ?? "") : "");
    setOpenMenu("none");
  };

  const clearModel = () => {
    setSelectedProvider("");
    setSelectedModelId("");
    setThinkingLevel("");
    setOpenMenu("none");
  };

  const toggle = (menu: OpenMenu) => {
    if (menu === "model" && openMenu !== "model" && modelPillRef.current) {
      const rect = modelPillRef.current.getBoundingClientRect();
      setModelMenuStyle({
        position: "fixed",
        bottom: `${window.innerHeight - rect.top + 6}px`,
        right: `${window.innerWidth - rect.right}px`,
        zIndex: 1010,
      });
    }
    setOpenMenu((cur) => (cur === menu ? "none" : menu));
    if (menu === "model") setModelFilter("");
  };

  const handleSubmit = () => {
    if (!canCreate) return;
    playButtonClick();
    onSubmit({
      name: name.trim() || undefined,
      prompt: prompt.trim(),
      schedule,
      workspaceId,
      environment,
      model: selectedProvider && selectedModelId
        ? { provider: selectedProvider, modelId: selectedModelId }
        : undefined,
      thinkingLevel: thinkingLevel || undefined,
    });
  };

  return (
    <div
      className="automation-builder-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="automation-builder">
        <div className="automation-builder__head">
          <input
            className="automation-builder__title"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Automation title"
            autoFocus
          />
          <button className="icon-button" type="button" title="Close" onClick={() => { playButtonSecondary(); onCancel(); }}>
            <CloseIcon />
          </button>
        </div>

        <textarea
          className="automation-builder__prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Add prompt e.g. look for crashes in $sentry"
        />

        <div className="automation-builder__bar" ref={barRef}>
          <div className="automation-builder__bar-left">
            {/* Environment */}
            <div className="ab-pill-wrap">
              <button className="ab-pill" type="button" onClick={() => toggle("env")}>
                {environment === "worktree" ? <WorktreeIcon /> : <MonitorIcon />}
                <span>{environment === "worktree" ? "Worktree" : "Local"}</span>
                <ChevronDownIcon />
              </button>
              {openMenu === "env" ? (
                <div className="ab-menu">
                  <button className="ab-menu__item" type="button" onClick={() => { setEnvironment("worktree"); setOpenMenu("none"); }}>
                    <WorktreeIcon /> Worktree
                  </button>
                  <button className="ab-menu__item" type="button" onClick={() => { setEnvironment("local"); setOpenMenu("none"); }}>
                    <MonitorIcon /> Local
                  </button>
                </div>
              ) : null}
            </div>

            {/* Project */}
            <div className="ab-pill-wrap">
              <button className="ab-pill" type="button" onClick={() => toggle("project")}>
                <ProjectIcon />
                <span>{selectedWorkspace?.name ?? "Select project"}</span>
                <ChevronDownIcon />
              </button>
              {openMenu === "project" ? (
                <div className="ab-menu ab-menu--scroll">
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      className={`ab-menu__item ${w.id === workspaceId ? "ab-menu__item--active" : ""}`}
                      type="button"
                      onClick={() => { setWorkspaceId(w.id); setOpenMenu("none"); }}
                    >
                      <ProjectIcon /> {w.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Schedule */}
            <div className="ab-pill-wrap">
              <button className="ab-pill" type="button" onClick={() => toggle("schedule")}>
                <ClockIcon />
                <span>{automationScheduleLabel(schedule)}</span>
                <ChevronDownIcon />
              </button>
              {openMenu === "schedule" ? (
                <div className="ab-menu ab-menu--schedule">
                  <span className="ab-menu__label">Frequency</span>
                  <div className="ab-seg">
                    {FREQUENCY_OPTIONS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        className={`ab-seg__btn ${frequency === f.value ? "ab-seg__btn--active" : ""}`}
                        onClick={() => setFrequency(f.value)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <span className="ab-menu__label">Time</span>
                  <div className="ab-seg">
                    {TIME_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`ab-seg__btn ${time === t ? "ab-seg__btn--active" : ""}`}
                        onClick={() => setTime(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Model */}
            <div className="ab-pill-wrap">
              <button
                ref={modelPillRef}
                className={`ab-icon-pill ${selectedModelId ? "ab-icon-pill--set" : ""}`}
                type="button"
                title={selectedModelRecord ? `Model: ${selectedModelRecord.label}` : "Model (workspace default)"}
                onClick={() => toggle("model")}
              >
                <ModelIcon />
              </button>
              {openMenu === "model" ? (
                <div className="ab-model-menu" style={modelMenuStyle}>
                  <div className="ab-model-menu__filter">
                    <input
                      className="ab-model-menu__filter-input"
                      placeholder="Filter models..."
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <button
                    className={`ab-model-menu__item ${!selectedModelId ? "ab-model-menu__item--active" : ""}`}
                    type="button"
                    onClick={clearModel}
                  >
                    <span className="ab-model-menu__item-label">Default (workspace model)</span>
                  </button>
                  {filteredGroupedModels.map((group) => (
                    <div key={group.provider}>
                      <div className="ab-model-menu__group-title">{group.provider}</div>
                      {group.items.map((opt) => {
                        const record = allModels.find(
                          (m) => m.providerId === opt.providerId && m.modelId === opt.modelId,
                        );
                        const isActive = opt.providerId === selectedProvider && opt.modelId === selectedModelId;
                        return (
                          <button
                            key={`${opt.providerId}:${opt.modelId}`}
                            className={`ab-model-menu__item ${isActive ? "ab-model-menu__item--active" : ""}`}
                            type="button"
                            onClick={() => selectModel(opt.providerId, opt.modelId, record?.availableThinkingLevels ?? [])}
                          >
                            <span className="ab-model-menu__item-label">{opt.label}</span>
                            <span className="ab-model-menu__item-meta">{record?.providerName ?? opt.providerId}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {filteredGroupedModels.length === 0 ? (
                    <div className="ab-model-menu__empty">No matching models</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Reasoning */}
            <div className="ab-pill-wrap">
              <button
                className={`ab-icon-pill ${thinkingLevel ? "ab-icon-pill--set" : ""}`}
                type="button"
                title={thinkingLevels.length === 0 ? "Reasoning (unavailable for this model)" : `Reasoning: ${thinkingLevel || "default"}`}
                disabled={thinkingLevels.length === 0}
                onClick={() => toggle("reasoning")}
              >
                <ReasoningIcon />
              </button>
              {openMenu === "reasoning" ? (
                <div className="ab-menu">
                  {thinkingLevels.map((level) => (
                    <button
                      key={level}
                      className={`ab-menu__item ${level === thinkingLevel ? "ab-menu__item--active" : ""}`}
                      type="button"
                      onClick={() => { setThinkingLevel(level); setOpenMenu("none"); }}
                    >
                      {thinkingLabels[level] ?? level}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="automation-builder__bar-right">
            <button className="button" type="button" onClick={() => { playButtonSecondary(); onCancel(); }}>
              Cancel
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={!canCreate}
              onClick={handleSubmit}
            >
              {initial ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
