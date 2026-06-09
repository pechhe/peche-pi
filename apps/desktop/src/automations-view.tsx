import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  Automation,
  AutomationFrequency,
  AutomationSchedule,
  NewThreadEnvironment,
  WorkspaceRecord,
} from "./desktop-state";
import { automationScheduleLabel } from "./desktop-state";
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
  environment: NewThreadEnvironment;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  enabled?: boolean;
}

export function AutomationsView({
  automations,
  workspaces,
  filterWorkspaceId,
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
          defaultWorkspaceId={filterWorkspaceId}
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

/* ── Create / Edit form ──────────────────────────────── */

interface AutomationFormProps {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly runtime?: RuntimeSnapshot;
  readonly initial?: Automation;
  readonly defaultWorkspaceId?: string;
  readonly onSubmit: (input: CreateAutomationInput) => void;
  readonly onCancel: () => void;
}

const SCHEDULE_PRESETS: { value: AutomationSchedulePreset; label: string }[] = [
  { value: "every-morning", label: "Every morning (9am)" },
  { value: "every-evening", label: "Every evening (6pm)" },
  { value: "weekdays-morning", label: "Weekday mornings (9am)" },
  { value: "hourly", label: "Hourly" },
];

function AutomationForm({
  workspaces,
  runtime,
  initial,
  defaultWorkspaceId,
  onSubmit,
  onCancel,
}: AutomationFormProps) {
  const modelSelectorRef = useRef<ModelSelectorHandle>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [scheduleKind, setScheduleKind] = useState<"preset" | "cron">(
    initial?.schedule.kind ?? "preset",
  );
  const [preset, setPreset] = useState<AutomationSchedulePreset>(
    initial?.schedule.kind === "preset" ? initial.schedule.preset : "every-morning",
  );
  const [cronExpression, setCronExpression] = useState(
    initial?.schedule.kind === "cron" ? initial.schedule.expression : "",
  );
  const [workspaceId, setWorkspaceId] = useState(
    initial?.workspaceId ?? defaultWorkspaceId ?? (workspaces[0]?.id ?? ""),
  );
  const [selectedProvider, setSelectedProvider] = useState(initial?.model?.provider ?? "");
  const [selectedModelId, setSelectedModelId] = useState(initial?.model?.modelId ?? "");
  const [thinkingLevel, setThinkingLevel] = useState(() => {
    if (initial?.thinkingLevel) return initial.thinkingLevel;
    if (initial?.model && runtime) {
      const record = runtime.models.find((m) => m.providerId === initial.model!.provider && m.modelId === initial.model!.modelId);
      const levels = record?.availableThinkingLevels ?? [];
      return levels.length > 0 ? (levels[0] ?? "") : "";
    }
    if (runtime) {
      const p = runtime.settings.defaultProvider;
      const mid = runtime.settings.defaultModelId;
      if (p && mid) {
        const record = runtime.models.find((m) => m.providerId === p && m.modelId === mid);
        const levels = record?.availableThinkingLevels ?? [];
        return levels.length > 0 ? (levels[0] ?? "") : "";
      }
    }
    return "";
  });

  const handleSetModel = useCallback((provider: string, modelId: string) => {
    setSelectedProvider(provider);
    setSelectedModelId(modelId);
    // Set default thinking level so the dial appears immediately
    if (runtime) {
      const record = runtime.models.find((m) => m.providerId === provider && m.modelId === modelId);
      const levels = record?.availableThinkingLevels ?? [];
      setThinkingLevel(levels.length > 0 ? (levels[0] ?? "") : "");
    } else {
      setThinkingLevel("");
    }
  }, [runtime]);

  const handleSetThinking = useCallback((level: string) => {
    setThinkingLevel(level);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || !workspaceId) return;

    const schedule: AutomationSchedule =
      scheduleKind === "preset"
        ? { kind: "preset", preset }
        : { kind: "cron", expression: cronExpression };

    const model = selectedProvider && selectedModelId ? {
      provider: selectedProvider,
      modelId: selectedModelId,
    } : undefined;

    onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      schedule,
      workspaceId,
      model,
      thinkingLevel: thinkingLevel || undefined,
    });
  };

  return (
    <form className="automation-form" onSubmit={handleSubmit}>
      <h2>{initial ? "Edit automation" : "New automation"}</h2>

      <label className="automation-form__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Morning code review"
          autoFocus
          required
        />
      </label>

      <label className="automation-form__field">
        <span>Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do?"
          rows={4}
          required
        />
      </label>

      <label className="automation-form__field">
        <span>Project</span>
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          required
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>

      <div className="automation-form__field automation-form__model">
        <span>Model</span>
        <ModelSelector
          ref={modelSelectorRef}
          runtime={runtime}
          provider={selectedProvider || undefined}
          modelId={selectedModelId || undefined}
          thinkingLevel={thinkingLevel || undefined}
          showEmptyModelControl
          emptyModelLabel="Default (workspace model)"
          emptyModelTitle="Use workspace default"
          onSetModel={handleSetModel}
          onSetThinking={handleSetThinking}
        />
      </div>

      <fieldset className="automation-form__field">
        <legend>Schedule</legend>
        <div className="automation-form__schedule-options">
          {SCHEDULE_PRESETS.map((p) => (
            <label key={p.value} className="automation-form__radio">
              <input
                type="radio"
                name="scheduleKind"
                checked={scheduleKind === "preset" && preset === p.value}
                onChange={() => { setScheduleKind("preset"); setPreset(p.value); }}
              />
              <span>{p.label}</span>
            </label>
          ))}
          <label className="automation-form__radio">
            <input
              type="radio"
              name="scheduleKind"
              checked={scheduleKind === "cron"}
              onChange={() => setScheduleKind("cron")}
            />
            <span>Custom cron</span>
          </label>
        </div>
        {scheduleKind === "cron" ? (
          <input
            type="text"
            className="automation-form__cron-input"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="0 9 * * 1-5"
          />
        ) : null}
      </fieldset>

      <div className="automation-form__actions">
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={!name.trim() || !prompt.trim() || !workspaceId}
        >
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}
