import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

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
 * Toast facade over sonner. Failures stay until dismissed; successes
 * auto-dismiss. Navigation-style toasts expose an "Open" action button.
 */
export function showToast(payload: ToastPayload): void {
  const duration =
    payload.autoDismissMs ?? (payload.variant === "success" ? 4000 : Number.POSITIVE_INFINITY);
  const options = {
    duration,
    description: payload.secondary,
    action: payload.onClick
      ? { label: "Open", onClick: payload.onClick }
      : undefined,
  };
  if (payload.variant === "success") {
    toast.success(payload.message, options);
  } else {
    toast.error(payload.message, options);
  }
}

/** Singleton toast outlet — renders the sonner Toaster. */
export function ToastHost() {
  return <Toaster position="bottom-right" closeButton />;
}
