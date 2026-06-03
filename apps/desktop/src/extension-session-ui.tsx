import { useEffect, useMemo, useState } from "react";
import type { HostUiResponse } from "@pi-gui/session-driver";
import type { SessionExtensionDialogRecord } from "./desktop-state";

export function ExtensionDialog({
  dialog,
  onRespond,
}: {
  readonly dialog: SessionExtensionDialogRecord;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (dialog.kind === "input") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    if (dialog.kind === "editor") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    setDraft("");
  }, [dialog]);

  if (dialog.kind === "questionnaire") {
    return <QuestionnaireDialog dialog={dialog} onRespond={onRespond} />;
  }

  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog" data-testid="extension-dialog">
        <div className="extension-dialog__title">{dialog.title}</div>
        {dialog.kind === "confirm" ? <p className="extension-dialog__body">{dialog.message}</p> : null}

        {dialog.kind === "select" ? (
          <div className="extension-dialog__options">
            {dialog.options.map((option) => (
              <button
                className="extension-dialog__option"
                key={option}
                type="button"
                onClick={() => onRespond({ requestId: dialog.requestId, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {dialog.kind === "input" ? (
          <input
            autoFocus
            className="skills-search"
            placeholder={dialog.placeholder ?? "Enter a value"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        {dialog.kind === "editor" ? (
          <textarea
            autoFocus
            className="extension-dialog__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        <div className="extension-dialog__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => onRespond({ requestId: dialog.requestId, cancelled: true })}
          >
            Cancel
          </button>
          {dialog.kind === "confirm" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onRespond({ requestId: dialog.requestId, confirmed: true })}
            >
              Confirm
            </button>
          ) : null}
          {dialog.kind === "input" || dialog.kind === "editor" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onRespond({ requestId: dialog.requestId, value: draft })}
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type QuestionnaireDialogRecord = Extract<SessionExtensionDialogRecord, { readonly kind: "questionnaire" }>;

interface DraftAnswer {
  readonly value: string;
  readonly label: string;
  readonly wasCustom: boolean;
  readonly index?: number;
}

function QuestionnaireDialog({
  dialog,
  onRespond,
}: {
  readonly dialog: QuestionnaireDialogRecord;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const total = dialog.questions.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const [otherDraft, setOtherDraft] = useState("");

  const current = dialog.questions[step];
  const recommendedIndex = useMemo(
    () => current?.options.findIndex((o) => o.recommended) ?? -1,
    [current],
  );

  useEffect(() => {
    setOtherDraft("");
  }, [step]);

  if (!current) {
    return null;
  }

  const commit = (next: Record<string, DraftAnswer>) => {
    if (step + 1 >= total) {
      const ordered = dialog.questions.map((q) => ({
        id: q.id,
        value: next[q.id]?.value ?? "",
        label: next[q.id]?.label ?? "",
        wasCustom: next[q.id]?.wasCustom ?? false,
        ...(next[q.id]?.index !== undefined ? { index: next[q.id]!.index } : {}),
      }));
      onRespond({ requestId: dialog.requestId, answers: ordered });
    } else {
      setStep(step + 1);
    }
  };

  const pickOption = (index: number) => {
    const option = current.options[index];
    if (!option) return;
    const next = {
      ...answers,
      [current.id]: { value: option.value, label: option.label, wasCustom: false, index },
    };
    setAnswers(next);
    commit(next);
  };

  const submitOther = () => {
    const text = otherDraft.trim();
    if (!text) return;
    const next = {
      ...answers,
      [current.id]: { value: text, label: text, wasCustom: true },
    };
    setAnswers(next);
    commit(next);
  };

  return (
    <div className="extension-dialog-backdrop">
      <div
        className="extension-dialog extension-dialog--questionnaire"
        data-testid="extension-dialog-questionnaire"
        role="dialog"
        aria-modal="true"
      >
        <div className="questionnaire__header">
          <div className="questionnaire__title">{dialog.title ?? "Questionnaire"}</div>
          <div className="questionnaire__progress">
            Question {step + 1} of {total}
          </div>
        </div>
        {step === 0 && dialog.intro ? <p className="questionnaire__intro">{dialog.intro}</p> : null}
        {current.label ? <div className="questionnaire__label">{current.label}</div> : null}
        <p className="questionnaire__prompt">{current.prompt}</p>

        <div className="questionnaire__options">
          {current.options.map((option, index) => (
            <button
              key={option.value + index}
              type="button"
              className={`questionnaire__option${index === recommendedIndex ? " questionnaire__option--recommended" : ""}`}
              onClick={() => pickOption(index)}
            >
              <div className="questionnaire__option-row">
                <span className="questionnaire__option-key">{index + 1}</span>
                <span className="questionnaire__option-label">{option.label}</span>
                {index === recommendedIndex ? (
                  <span className="questionnaire__option-badge">recommended</span>
                ) : null}
              </div>
              {option.description ? (
                <div className="questionnaire__option-description">{option.description}</div>
              ) : null}
            </button>
          ))}
        </div>

        {current.allowOther ? (
          <div className="questionnaire__other">
            <input
              type="text"
              className="skills-search"
              placeholder={current.otherPlaceholder ?? "Other (free text)"}
              value={otherDraft}
              onChange={(event) => setOtherDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitOther();
                }
              }}
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={submitOther}
              disabled={!otherDraft.trim()}
            >
              Use this answer
            </button>
          </div>
        ) : null}

        <div className="extension-dialog__actions">
          {step > 0 ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onRespond({ requestId: dialog.requestId, cancelled: true })}
          >
            Stop grilling
          </button>
        </div>
      </div>
    </div>
  );
}
