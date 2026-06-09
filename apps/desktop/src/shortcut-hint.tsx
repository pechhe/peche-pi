interface ShortcutHintProps {
  /** Keycap text, e.g. "⌘P" or "⌘1–4". */
  readonly keys: string;
}

/**
 * A keycap hint anchored above a composer control. Always in the DOM but
 * absolutely positioned and hidden (opacity 0) until the user holds ⌘ long
 * enough to reveal hints — see shortcut-hints.ts (`.pi-hints-visible`). Being
 * absolute means it never shifts the resting composer layout.
 */
export function ShortcutHint({ keys }: ShortcutHintProps) {
  return (
    <span className="shortcut-hint" aria-hidden="true">
      {keys}
    </span>
  );
}
