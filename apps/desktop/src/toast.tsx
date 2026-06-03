import { useEffect, useState } from "react";

export type ToastVariant = "success" | "error";

export interface ToastPayload {
  readonly variant: ToastVariant;
  readonly message: string;
  /** Optional millisecond auto-dismiss override. Failures default to sticky; successes default to 4000ms. */
  readonly autoDismissMs?: number;
}

/**
 * Toast event protocol. Other components fire `pi:toast` with a ToastPayload;
 * the singleton `<ToastHost />` renders at most one at a time. New toasts
 * replace the current one (no stacking — keeps cognitive load low).
 */
export const TOAST_EVENT = "pi:toast";

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

  return (
    <div className={`toast toast--${toast.variant}`} role={toast.variant === "error" ? "alert" : "status"}>
      <span className="toast__message">{toast.message}</span>
      <button
        aria-label="Dismiss"
        className="toast__close"
        type="button"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
