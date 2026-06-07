import { useEffect, useState } from "react";

export type ToastVariant = "success" | "error";

export interface ToastPayload {
  readonly variant: ToastVariant;
  readonly message: string;
  /** Optional millisecond auto-dismiss override. Failures default to sticky; successes default to 4000ms. */
  readonly autoDismissMs?: number;
  /** Optional secondary text shown after a dot separator. */
  readonly secondary?: string;
  /** Optional click action for navigation-style toasts. */
  readonly onClick?: () => void;
}

/**
 * Toast event protocol. Other components fire `pi:toast` with a ToastPayload;
 * the singleton `<ToastHost />` renders at most one at a time. New toasts
 * replace the current one (no stacking — keeps cognitive load low).
 */
const TOAST_EVENT = "pi:toast";

export function showToast(payload: ToastPayload): void {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

interface ActiveToast extends ToastPayload {
  readonly id: number;
}

export function ToastHost() {
  const [toast, setToast] = useState<ActiveToast | null>(null);

  useEffect(() => {
    let nextId = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      if (!detail) return;
      nextId += 1;
      setToast({ ...detail, id: nextId });
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const defaultMs = toast.variant === "success" ? 4000 : undefined;
    const ms = toast.autoDismissMs ?? defaultMs;
    if (ms === undefined) return undefined;
    const handle = window.setTimeout(() => {
      setToast((current) => (current && current.id === toast.id ? null : current));
    }, ms);
    return () => window.clearTimeout(handle);
  }, [toast]);

  if (!toast) return null;

  const icon =
    toast.variant === "success" ? (
      <svg className="toast__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill="var(--accent)" />
        <path
          d="M4.5 8.5L6.5 10.5L11.5 5.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg className="toast__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill="var(--error-ink)" />
        <path
          d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );

  const body = (
    <>
      {icon}
      <span className="toast__message">
        {toast.message}
        {toast.secondary ? <span className="toast__secondary"> · {toast.secondary}</span> : null}
      </span>
    </>
  );

  return (
    <div className={`toast toast--${toast.variant}`} role={toast.variant === "error" ? "alert" : "status"}>
      {toast.onClick ? (
        <button
          className="toast__action"
          type="button"
          onClick={() => {
            toast.onClick?.();
            setToast(null);
          }}
        >
          {body}
        </button>
      ) : body}
      <button aria-label="Dismiss" className="toast__close" type="button" onClick={() => setToast(null)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
