import { useEffect } from "react";

interface ShortcutsSheetProps {
  readonly platform: NodeJS.Platform;
  readonly onClose: () => void;
}

interface ShortcutRow {
  readonly keys: readonly string[];
  readonly label: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

/**
 * Full keyboard-shortcut reference, opened with ⌘/ (toggle). Companion to the
 * hold-⌘ in-context hints: the hints say "this control has shortcuts", this
 * sheet is the exhaustive map.
 */
export function ShortcutsSheet({ platform, onClose }: ShortcutsSheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mod = platform === "darwin" ? "⌘" : "Ctrl";
  const shift = platform === "darwin" ? "⇧" : "Shift";

  const groups: readonly ShortcutGroup[] = [
    {
      title: "Composer",
      rows: [
        { keys: [`${mod}L`], label: "Focus composer" },
        { keys: [`${mod}B`], label: "Build mode" },
        { keys: [`${mod}P`], label: "Plan mode" },
        { keys: [`${mod}1`, `${mod}2`, `${mod}3`], label: "Select model slot" },
        { keys: [`${mod}4`, `${mod}T`], label: "Open model menu" },
        { keys: [`${mod}↑`, `${mod}↓`], label: "Adjust reasoning level" },
        { keys: [`${shift}Tab`], label: "Cycle reasoning level" },
      ],
    },
    {
      title: "Navigation",
      rows: [
        { keys: [`${mod}F`], label: "Find in thread" },
        { keys: [`${mod}[`, `${mod}]`], label: "Back / forward" },
        { keys: [`${mod}N`, `${mod}${shift}O`], label: "New thread" },
        { keys: [`${mod}${shift}↑`, `${mod}${shift}↓`], label: "Navigate sidebar threads" },
      ],
    },
    {
      title: "Sidebar",
      rows: [
        { keys: [`${mod}${shift}1`], label: "Agents" },
        { keys: [`${mod}${shift}2`], label: "Skills" },
        { keys: [`${mod}${shift}3`], label: "Extensions" },
        { keys: [`${mod}${shift}4`], label: "Automations" },
        { keys: [`${mod}${shift}5`], label: "Context" },
        { keys: [`${mod},`], label: "Settings" },
      ],
    },
    {
      title: "Panels & workspace",
      rows: [
        { keys: [`${mod}D`], label: "Toggle diff panel" },
        { keys: [`${mod}J`], label: "Toggle terminal" },
        { keys: [`${mod}S`], label: "Toggle sidebar" },
        { keys: [`${mod},`], label: "Settings" },
        { keys: [`${mod}${shift}K`], label: "Commit & push" },
      ],
    },
    {
      title: "Help",
      rows: [{ keys: [`${mod}/`], label: "Toggle this sheet" }],
    },
  ];

  return (
    <div
      className="shortcuts-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="shortcuts-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="shortcuts-sheet__header">
          <div>
            <div className="shortcuts-sheet__eyebrow">Keyboard</div>
            <h2 className="shortcuts-sheet__title">Shortcuts</h2>
          </div>
          <button
            aria-label="Close shortcuts"
            className="shortcuts-sheet__close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="shortcuts-sheet__groups">
          {groups.map((group) => (
            <section className="shortcuts-sheet__group" key={group.title}>
              <div className="shortcuts-sheet__group-title">{group.title}</div>
              {group.rows.map((row) => (
                <div className="shortcuts-sheet__row" key={row.label}>
                  <span className="shortcuts-sheet__keys">
                    {row.keys.map((key, index) => (
                      <kbd className="shortcuts-sheet__kbd" key={index}>
                        {key}
                      </kbd>
                    ))}
                  </span>
                  <span className="shortcuts-sheet__label">{row.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="shortcuts-sheet__footer">Hold {mod} to reveal shortcuts on the composer controls.</div>
      </div>
    </div>
  );
}
