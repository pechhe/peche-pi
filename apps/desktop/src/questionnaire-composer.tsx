import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { HostUiResponse } from "@pi-gui/session-driver";
import type { SessionExtensionDialogRecord } from "./desktop-state";

type QuestionnaireRequest = Extract<SessionExtensionDialogRecord, { readonly kind: "questionnaire" }>;

interface DraftAnswer {
  readonly value: string;
  readonly label: string;
  readonly wasCustom: boolean;
  readonly index?: number;
}

export function QuestionnaireComposer({
  request,
  onRespond,
}: {
  readonly request: QuestionnaireRequest;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const total = request.questions.length;
  const [step, setStep] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const [otherDraft, setOtherDraft] = useState("");
  const [isOtherActive, setIsOtherActive] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const current = request.questions[step];
  const optionCount = current ? current.options.length + (current.allowOther ? 1 : 0) : 0;

  useEffect(() => {
    shellRef.current?.focus();
  }, [request.requestId]);

  // Restore the saved selection only when navigating between questions (or a
  // new request arrives). Depending on `answers`/`request.questions` here made
  // the effect re-run on every parent re-render (e.g. streaming context-usage
  // updates), snapping the highlight back to the recommended option mid-nav.
  useEffect(() => {
    const next = request.questions[step];
    const saved = next ? answers[next.id] : undefined;
    const recommended = next?.options.findIndex((option) => option.recommended) ?? -1;
    setSelectedIndex(saved?.index ?? (recommended >= 0 ? recommended : 0));
    setOtherDraft(saved?.wasCustom ? saved.value : "");
    setIsOtherActive(Boolean(saved?.wasCustom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, request.requestId]);

  if (!current) {
    return null;
  }

  const commit = (nextAnswers: Record<string, DraftAnswer>) => {
    if (step + 1 >= total) {
      onRespond({
        requestId: request.requestId,
        answers: request.questions.map((question) => ({
          id: question.id,
          value: nextAnswers[question.id]?.value ?? "",
          label: nextAnswers[question.id]?.label ?? "",
          wasCustom: nextAnswers[question.id]?.wasCustom ?? false,
          ...(nextAnswers[question.id]?.index !== undefined ? { index: nextAnswers[question.id]!.index } : {}),
        })),
      });
      return;
    }
    setStep((value) => value + 1);
  };

  const pickOption = (index: number) => {
    if (index >= current.options.length) {
      setSelectedIndex(current.options.length);
      setIsOtherActive(true);
      return;
    }
    const option = current.options[index];
    if (!option) {
      return;
    }
    const nextAnswers = {
      ...answers,
      [current.id]: { value: option.value, label: option.label, wasCustom: false, index },
    };
    setAnswers(nextAnswers);
    commit(nextAnswers);
  };

  const submitOther = () => {
    const text = otherDraft.trim();
    if (!text) {
      setIsOtherActive(true);
      return;
    }
    const nextAnswers = {
      ...answers,
      [current.id]: { value: text, label: text, wasCustom: true },
    };
    setAnswers(nextAnswers);
    commit(nextAnswers);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onRespond({ requestId: request.requestId, cancelled: true });
      return;
    }
    if (isOtherActive) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((value) => Math.min(optionCount - 1, value + 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pickOption(selectedIndex);
    }
  };

  const sectionLabel = current.label ?? request.title;
  const otherIndex = current.options.length;
  const otherSelected = selectedIndex === otherIndex || isOtherActive;

  return (
    <div
      className="questionnaire-composer"
      data-testid="questionnaire-composer"
      role="group"
      tabIndex={0}
      ref={shellRef}
      onKeyDown={handleKeyDown}
    >
      <div className="questionnaire-composer__screen">
        <div className="questionnaire-composer__header">
          <div className="questionnaire-composer__heading">
            {sectionLabel ? (
              <div className="questionnaire-composer__eyebrow">{sectionLabel}</div>
            ) : null}
            <h2 className="questionnaire-composer__prompt">{current.prompt}</h2>
            {step === 0 && request.intro ? (
              <div className="questionnaire-composer__intro">{request.intro}</div>
            ) : null}
          </div>
          <div
            className="questionnaire-composer__progress"
            aria-label={`Question ${step + 1} of ${total}`}
          >
            <div className="questionnaire-composer__steps" aria-hidden="true">
              {request.questions.map((question, index) => (
                <span
                  key={question.id}
                  className={`questionnaire-composer__step${index === step ? " questionnaire-composer__step--active" : ""}`}
                />
              ))}
            </div>
            <span className="questionnaire-composer__count">
              {step + 1} / {total}
            </span>
          </div>
        </div>

        <div className="questionnaire-composer__options" role="radiogroup">
          {current.options.map((option, index) => {
            const selected = index === selectedIndex && !isOtherActive;
            return (
              <button
                key={`${option.value}:${index}`}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`questionnaire-composer__option${selected ? " questionnaire-composer__option--selected" : ""}`}
                onClick={() => pickOption(index)}
              >
                <span className="questionnaire-composer__cursor" aria-hidden="true">
                  {selected ? ">" : ""}
                </span>
                <span className="questionnaire-composer__option-label">{option.label}</span>
              </button>
            );
          })}

          {current.allowOther ? (
            <button
              type="button"
              role="radio"
              aria-checked={otherSelected}
              className={`questionnaire-composer__option${otherSelected ? " questionnaire-composer__option--selected" : ""}`}
              onClick={() => {
                setSelectedIndex(otherIndex);
                setIsOtherActive(true);
              }}
            >
              <span className="questionnaire-composer__cursor" aria-hidden="true">
                {otherSelected ? ">" : ""}
              </span>
              <span className="questionnaire-composer__option-label">Other…</span>
            </button>
          ) : null}
        </div>

        {isOtherActive ? (
          <form
            className="questionnaire-composer__other"
            onSubmit={(event) => {
              event.preventDefault();
              submitOther();
            }}
          >
            <input
              autoFocus
              value={otherDraft}
              placeholder={current.otherPlaceholder ?? "Type another answer"}
              onChange={(event) => setOtherDraft(event.target.value)}
            />
            <button type="submit" disabled={!otherDraft.trim()}>
              Use
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
