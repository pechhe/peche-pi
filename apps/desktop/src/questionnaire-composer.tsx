import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  const recommendedIndex = useMemo(
    () => current?.options.findIndex((option) => option.recommended) ?? -1,
    [current],
  );

  useEffect(() => {
    shellRef.current?.focus();
  }, [request.requestId]);

  useEffect(() => {
    const next = request.questions[step];
    const saved = next ? answers[next.id] : undefined;
    const nextSelected = saved?.index ?? (recommendedIndex >= 0 ? recommendedIndex : 0);
    setSelectedIndex(nextSelected);
    setOtherDraft(saved?.wasCustom ? saved.value : "");
    setIsOtherActive(Boolean(saved?.wasCustom));
  }, [answers, recommendedIndex, request.questions, step]);

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

  const progressPercent = total > 0 ? ((step + 1) / total) * 100 : 0;

  return (
    <footer className="composer composer--questionnaire">
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
            <div className="questionnaire-composer__prompt">{current.prompt}</div>
            <div
              className="composer__context questionnaire-composer__progress"
              aria-label={`Question ${step + 1} of ${total}`}
            >
              <span className="composer__context-label questionnaire-composer__progress-label">
                {step + 1} / {total}
              </span>
              <div className="composer__context-track questionnaire-composer__progress-track">
                <div className="composer__context-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </div>

          {step === 0 && request.intro ? (
            <div className="questionnaire-composer__intro">{request.intro}</div>
          ) : null}
          {current.label ? <div className="questionnaire-composer__label">{current.label}</div> : null}

          <div className="questionnaire-composer__options">
            {current.options.map((option, index) => (
              <button
                key={`${option.value}:${index}`}
                type="button"
                className={`questionnaire-composer__option${index === selectedIndex && !isOtherActive ? " questionnaire-composer__option--selected" : ""}`}
                onClick={() => pickOption(index)}
              >
                <span className="questionnaire-composer__cursor">{index === selectedIndex && !isOtherActive ? ">" : ""}</span>
                <span>{option.label}</span>
              </button>
            ))}
            {current.allowOther ? (
              <button
                type="button"
                className={`questionnaire-composer__option${selectedIndex === current.options.length || isOtherActive ? " questionnaire-composer__option--selected" : ""}`}
                onClick={() => {
                  setSelectedIndex(current.options.length);
                  setIsOtherActive(true);
                }}
              >
                <span className="questionnaire-composer__cursor">{selectedIndex === current.options.length || isOtherActive ? ">" : ""}</span>
                <span>Other (please specify)</span>
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
              <span className="questionnaire-composer__cursor">&gt;</span>
              <input
                autoFocus
                value={otherDraft}
                placeholder={current.otherPlaceholder ?? "Type another answer"}
                onChange={(event) => setOtherDraft(event.target.value)}
              />
              <button type="submit" disabled={!otherDraft.trim()}>Use</button>
            </form>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
