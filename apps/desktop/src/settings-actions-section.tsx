import { useCallback, useMemo, useRef, useState } from "react";
import type { ChassisAction, ChassisActionCandidate } from "./chassis";
import { WRAP_INPUT_TOKEN } from "./chassis";
import { buildSlashCommandSections } from "./composer-commands";
import type { PiDesktopApi } from "./ipc";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface SettingsActionsSectionProps {
  readonly api: PiDesktopApi | null | undefined;
  readonly chassisActions: readonly ChassisAction[];
  readonly refreshChassisActions?: () => void;
  readonly runtime?: RuntimeSnapshot;
  /** Active project folder; Chassis Actions are scoped per folder (#51). */
  readonly chassisFolderPath?: string;
}

export function SettingsActionsSection({
  api,
  chassisActions,
  refreshChassisActions,
  runtime,
  chassisFolderPath,
}: SettingsActionsSectionProps) {
  const [label, setLabel] = useState("");
  const [payload, setPayload] = useState("");
  const [showLabel, setShowLabel] = useState(true);
  const [trigger, setTrigger] = useState<"oneShot" | "sticky">("oneShot");
  const [stickyType, setStickyType] = useState<"wrap" | "reminder">("wrap");
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPayload, setEditPayload] = useState("");
  const [editShowLabel, setEditShowLabel] = useState(true);
  const [editTrigger, setEditTrigger] = useState<"oneShot" | "sticky">("oneShot");
  const [editStickyType, setEditStickyType] = useState<"wrap" | "reminder">("wrap");
  const [editTemplateError, setEditTemplateError] = useState<string | null>(null);

  // ── Builder (Composer Layout Builder, #55) ──────────────────────────────
  interface BuilderMessage {
    readonly role: "user" | "assistant";
    readonly content: string;
  }
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMessages, setBuilderMessages] = useState<BuilderMessage[]>([]);
  const [builderInput, setBuilderInput] = useState("");
  const [builderLoading, setBuilderLoading] = useState(false);
  const [builderCandidate, setBuilderCandidate] = useState<ChassisActionCandidate | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const builderEndRef = useRef<HTMLDivElement>(null);

  const availableCommands = useMemo(() => {
    const sections = buildSlashCommandSections("/", runtime, []);
    return sections
      .flatMap((s) => s.items)
      .filter((cmd) => cmd.runtimeCommand)
      .map((cmd) => ({ label: cmd.title, command: cmd.command }));
  }, [runtime]);

  const handleBuilderSend = useCallback(async () => {
    if (!api || !builderInput.trim() || builderLoading) return;
    const userMsg: BuilderMessage = { role: "user", content: builderInput.trim() };
    const nextMessages = [...builderMessages, userMsg];
    setBuilderMessages(nextMessages);
    setBuilderInput("");
    setBuilderLoading(true);
    setBuilderError(null);
    setBuilderCandidate(null);
    try {
      const result = await api.buildChassisActionCandidate({
        messages: nextMessages,
        availableCommands,
      });
      const assistantMsg: BuilderMessage = { role: "assistant", content: result.assistantMessage };
      setBuilderMessages([...nextMessages, assistantMsg]);
      setBuilderCandidate(result.candidate);
      if (result.validationError) {
        setBuilderError(result.validationError);
      }
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilderLoading(false);
      requestAnimationFrame(() => builderEndRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }, [api, builderInput, builderMessages, builderLoading, availableCommands]);

  const handleBuilderAccept = useCallback(async () => {
    if (!api || !chassisFolderPath || !builderCandidate) return;
    const newAction: ChassisAction = {
      id: crypto.randomUUID(),
      ...builderCandidate,
    };
    await api.setChassisFolderActions(chassisFolderPath, [...chassisActions, newAction]);
    setBuilderCandidate(null);
    setBuilderMessages([]);
    refreshChassisActions?.();
  }, [api, chassisFolderPath, builderCandidate, chassisActions, refreshChassisActions]);

  const handleBuilderDecline = useCallback(() => {
    setBuilderCandidate(null);
  }, []);

  const handleBuilderReset = useCallback(() => {
    setBuilderMessages([]);
    setBuilderCandidate(null);
    setBuilderError(null);
    setBuilderInput("");
  }, []);

  const runtimeCommands = useMemo(() => {
    const sections = buildSlashCommandSections("/", runtime, []);
    return sections
      .flatMap((s) => s.items)
      .filter((cmd) => cmd.runtimeCommand)
      .map((cmd) => ({ label: cmd.title, value: cmd.command }));
  }, [runtime]);

  const handleCreate = () => {
    if (!api || !chassisFolderPath || !label.trim() || !payload.trim()) return;
    if (trigger === "sticky") {
      if (stickyType === "wrap") {
        if (!payload.includes(WRAP_INPUT_TOKEN)) {
          setTemplateError(`Template must contain ${WRAP_INPUT_TOKEN}`);
          return;
        }
      }
      const newAction: ChassisAction = {
        id: crypto.randomUUID(),
        label: label.trim(),
        showLabel,
        trigger: "sticky",
        effect: stickyType === "reminder"
          ? { type: "reminder", text: payload.trim() }
          : { type: "wrap", template: payload.trim() },
      };
      void api.setChassisFolderActions(chassisFolderPath, [...chassisActions, newAction]).then(() => {
        setLabel("");
        setPayload("");
        setShowLabel(true);
        setTrigger("oneShot");
        setStickyType("wrap");
        setTemplateError(null);
        refreshChassisActions?.();
      });
    } else {
      const newAction: ChassisAction = {
        id: crypto.randomUUID(),
        label: label.trim(),
        showLabel,
        trigger: "oneShot",
        effect: { type: "submit", text: payload.trim() },
      };
      void api.setChassisFolderActions(chassisFolderPath, [...chassisActions, newAction]).then(() => {
        setLabel("");
        setPayload("");
        setShowLabel(true);
        refreshChassisActions?.();
      });
    }
  };

  const handlePayloadChange = (value: string) => {
    setPayload(value);
    if (templateError) {
      setTemplateError(null);
    }
  };

  const handleStartEdit = (action: ChassisAction) => {
    setEditingId(action.id);
    setEditLabel(action.label);
    setEditPayload(
      action.effect.type === "wrap" ? (action.effect as import("./chassis").ChassisWrapEffect).template : action.effect.text,
    );
    setEditShowLabel(action.showLabel);
    setEditTrigger(action.trigger);
    setEditStickyType(action.effect.type === "reminder" ? "reminder" : "wrap");
    setEditTemplateError(null);
  };

  const handleSaveEdit = (action: ChassisAction) => {
    if (!api || !chassisFolderPath || !editLabel.trim() || !editPayload.trim()) return;
    if (editTrigger === "sticky" && editStickyType === "wrap" && !editPayload.includes(WRAP_INPUT_TOKEN)) {
      setEditTemplateError(`Template must contain ${WRAP_INPUT_TOKEN}`);
      return;
    }
    const updated: ChassisAction =
      editTrigger === "sticky"
        ? {
            ...action,
            label: editLabel.trim(),
            showLabel: editShowLabel,
            trigger: "sticky",
            effect: editStickyType === "reminder"
              ? { type: "reminder", text: editPayload.trim() }
              : { type: "wrap", template: editPayload.trim() },
          }
        : {
            ...action,
            label: editLabel.trim(),
            showLabel: editShowLabel,
            trigger: "oneShot",
            effect: { type: "submit", text: editPayload.trim() },
          };
    void api
      .setChassisFolderActions(chassisFolderPath, chassisActions.map((a) => (a.id === action.id ? updated : a)))
      .then(() => {
        setEditingId(null);
        refreshChassisActions?.();
      });
  };

  const handleDelete = (id: string) => {
    if (!api || !chassisFolderPath) return;
    void api
      .setChassisFolderActions(chassisFolderPath, chassisActions.filter((a) => a.id !== id))
      .then(() => {
        refreshChassisActions?.();
      });
  };

  if (!chassisFolderPath) {
    return (
      <SettingsGroup title="Actions" description="One-shot buttons, sticky wrap toggles, or sticky reminders that send prompts.">
        <SettingsRow title="Actions">
          <span data-testid="chassis-actions-no-folder">Open a project folder to configure actions.</span>
        </SettingsRow>
      </SettingsGroup>
    );
  }

  return (
    <>
    {/* ── Builder panel (#55) ──────────────────────────────────────────── */}
    <SettingsGroup title="Action Builder" description="Describe a Chassis Action in plain language and let your configured model propose one.">
      <SettingsRow title="Builder">
        <div style={{ width: "100%" }}>
          <button
            type="button"
            className="button button--secondary"
            data-testid="chassis-builder-toggle"
            onClick={() => setBuilderOpen(!builderOpen)}
          >
            {builderOpen ? "Close builder" : "Open builder"}
          </button>
        </div>
        {builderOpen ? (
          <div data-testid="chassis-builder-panel" style={{ width: "100%", marginTop: "0.5rem" }}>
            {/* Messages */}
            <div
              data-testid="chassis-builder-messages"
              style={{
                maxHeight: "240px",
                overflowY: "auto",
                border: "1px solid var(--color-border, #444)",
                borderRadius: "6px",
                padding: "0.5rem",
                marginBottom: "0.5rem",
                fontSize: "0.85em",
              }}
            >
              {builderMessages.length === 0 ? (
                <div style={{ color: "var(--color-text-muted, #888)", fontStyle: "italic" }}>
                  Describe what you want — e.g. "a button that runs /review" or "a sticky toggle that wraps prompts with a caveman instruction".
                </div>
              ) : (
                builderMessages.map((msg, i) => (
                  <div
                    key={i}
                    data-testid={`chassis-builder-msg-${i}`}
                    style={{
                      marginBottom: "0.5rem",
                      padding: "0.35rem 0.5rem",
                      borderRadius: "4px",
                      background: msg.role === "user"
                        ? "var(--color-bg-active, rgba(255,255,255,0.06))"
                        : "transparent",
                    }}
                  >
                    <strong>{msg.role === "user" ? "You" : "Assistant"}:</strong> {msg.content}
                  </div>
                ))
              )}
              {builderLoading ? (
                <div data-testid="chassis-builder-loading" style={{ color: "var(--color-text-muted, #888)", fontStyle: "italic" }}>
                  Thinking…
                </div>
              ) : null}
              <div ref={builderEndRef} />
            </div>

            {/* Candidate card */}
            {builderCandidate ? (
              <div
                data-testid="chassis-builder-candidate"
                style={{
                  border: "1px solid var(--color-accent, #4a9eff)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  Candidate: {builderCandidate.label}
                </div>
                <div style={{ fontSize: "0.85em", color: "var(--color-text-secondary, #aaa)", marginBottom: "0.5rem" }}>
                  {builderCandidate.trigger === "oneShot"
                    ? `One-shot → sends: "${builderCandidate.effect.type === "submit" ? builderCandidate.effect.text : ""}"`
                    : builderCandidate.effect.type === "wrap"
                      ? `Sticky wrap → template: "${builderCandidate.effect.template}"`
                      : `Sticky reminder → "${builderCandidate.effect.type === "reminder" ? builderCandidate.effect.text : ""}"`}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="button button--secondary"
                    data-testid="chassis-builder-accept"
                    onClick={handleBuilderAccept}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    data-testid="chassis-builder-decline"
                    onClick={handleBuilderDecline}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : null}

            {/* Error */}
            {builderError ? (
              <div data-testid="chassis-builder-error" style={{ color: "var(--color-error, #e74c3c)", fontSize: "0.85em", marginBottom: "0.5rem" }}>
                {builderError}
              </div>
            ) : null}

            {/* Input */}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                data-testid="chassis-builder-input"
                placeholder="Describe your action…"
                value={builderInput}
                onChange={(e) => setBuilderInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleBuilderSend(); } }}
                disabled={builderLoading}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="button button--secondary"
                data-testid="chassis-builder-send"
                disabled={!builderInput.trim() || builderLoading}
                onClick={() => void handleBuilderSend()}
              >
                Send
              </button>
              {builderMessages.length > 0 ? (
                <button
                  type="button"
                  className="button button--ghost"
                  data-testid="chassis-builder-reset"
                  onClick={handleBuilderReset}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title="Actions" description="One-shot buttons, sticky wrap toggles, or sticky reminders that send prompts.">
      <SettingsRow title="Create action">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            data-testid="chassis-action-label-input"
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: "1 1 120px", minWidth: 0 }}
          />
          <select
            data-testid="chassis-action-trigger"
            value={trigger === "sticky" && stickyType === "reminder" ? "sticky-reminder" : trigger}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "sticky-reminder") {
                setTrigger("sticky");
                setStickyType("reminder");
              } else {
                setTrigger(v as "oneShot" | "sticky");
                setStickyType("wrap");
              }
              setTemplateError(null);
            }}
            style={{ flex: "0 0 auto" }}
          >
            <option value="oneShot">One-shot</option>
            <option value="sticky">Sticky wrap</option>
            <option value="sticky-reminder">Sticky reminder</option>
          </select>
          {trigger === "oneShot" && runtimeCommands.length > 0 ? (
            <select
              data-testid="chassis-action-command-picker"
              value=""
              onChange={(e) => {
                if (e.target.value) setPayload(e.target.value);
              }}
              style={{ flex: "0 0 auto" }}
            >
              <option value="">Pick command…</option>
              {runtimeCommands.map((cmd) => (
                <option key={cmd.value} value={cmd.value}>
                  {cmd.label}
                </option>
              ))}
            </select>
          ) : null}
          <input
            type="text"
            data-testid="chassis-action-payload-input"
            placeholder={trigger === "sticky" ? (stickyType === "reminder" ? "Reminder text" : `Wrap template with ${WRAP_INPUT_TOKEN}`) : "Payload text"}
            value={payload}
            onChange={(e) => handlePayloadChange(e.target.value)}
            style={{ flex: "2 1 180px", minWidth: 0 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              data-testid="chassis-action-showlabel"
              checked={showLabel}
              onChange={(e) => setShowLabel(e.target.checked)}
            />
            Show label
          </label>
          <button
            type="button"
            className="button button--secondary"
            data-testid="chassis-action-create"
            disabled={!label.trim() || !payload.trim()}
            onClick={handleCreate}
          >
            Add
          </button>
        </div>
        {templateError ? (
          <div data-testid="chassis-action-template-error" style={{ color: "var(--color-error, #e74c3c)", fontSize: "0.85em", marginTop: "0.25rem" }}>
            {templateError}
          </div>
        ) : null}
      </SettingsRow>
      {chassisActions.length > 0 ? (
        chassisActions.map((action) => (
          <div key={action.id} data-testid={`chassis-action-row-${action.id}`}>
            {editingId === action.id ? (
              <SettingsRow title="Edit action">
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    data-testid={`chassis-action-edit-label-${action.id}`}
                    placeholder="Label"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    style={{ flex: "1 1 120px", minWidth: 0 }}
                  />
                  <select
                    data-testid={`chassis-action-edit-trigger-${action.id}`}
                    value={editTrigger === "sticky" && editStickyType === "reminder" ? "sticky-reminder" : editTrigger}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "sticky-reminder") {
                        setEditTrigger("sticky");
                        setEditStickyType("reminder");
                      } else {
                        setEditTrigger(v as "oneShot" | "sticky");
                        setEditStickyType("wrap");
                      }
                      setEditTemplateError(null);
                    }}
                    style={{ flex: "0 0 auto" }}
                  >
                    <option value="oneShot">One-shot</option>
                    <option value="sticky">Sticky wrap</option>
                    <option value="sticky-reminder">Sticky reminder</option>
                  </select>
                  {editTrigger === "oneShot" && runtimeCommands.length > 0 ? (
                    <select
                      data-testid="chassis-action-command-picker"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) setEditPayload(e.target.value);
                      }}
                      style={{ flex: "0 0 auto" }}
                    >
                      <option value="">Pick command…</option>
                      {runtimeCommands.map((cmd) => (
                        <option key={cmd.value} value={cmd.value}>
                          {cmd.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    type="text"
                    data-testid={`chassis-action-edit-payload-${action.id}`}
                    placeholder={
                      editTrigger === "sticky"
                        ? (editStickyType === "reminder" ? "Reminder text" : `Wrap template with ${WRAP_INPUT_TOKEN}`)
                        : "Payload text"
                    }
                    value={editPayload}
                    onChange={(e) => {
                      setEditPayload(e.target.value);
                      if (editTemplateError) setEditTemplateError(null);
                    }}
                    style={{ flex: "2 1 180px", minWidth: 0 }}
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`chassis-action-edit-showlabel-${action.id}`}
                      checked={editShowLabel}
                      onChange={(e) => setEditShowLabel(e.target.checked)}
                    />
                    Show label
                  </label>
                  <button
                    type="button"
                    className="button button--secondary"
                    data-testid={`chassis-action-save-${action.id}`}
                    disabled={!editLabel.trim() || !editPayload.trim()}
                    onClick={() => handleSaveEdit(action)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
                {editTemplateError ? (
                  <div
                    data-testid="chassis-action-edit-template-error"
                    style={{
                      color: "var(--color-error, #e74c3c)",
                      fontSize: "0.85em",
                      marginTop: "0.25rem",
                    }}
                  >
                    {editTemplateError}
                  </div>
                ) : null}
              </SettingsRow>
            ) : (
              <SettingsRow
                title={action.label}
                description={
                  action.trigger === "sticky" && action.effect.type === "wrap"
                    ? action.effect.template
                    : action.effect.type === "submit"
                      ? action.effect.text
                      : action.effect.type === "reminder"
                        ? action.effect.text
                        : ""
                }
              >
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="button button--secondary"
                    data-testid={`chassis-action-edit-${action.id}`}
                    onClick={() => handleStartEdit(action)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    data-testid={`chassis-action-delete-${action.id}`}
                    onClick={() => handleDelete(action.id)}
                  >
                    Delete
                  </button>
                </div>
              </SettingsRow>
            )}
          </div>
        ))
      ) : null}
    </SettingsGroup>
    </>
  );
}
