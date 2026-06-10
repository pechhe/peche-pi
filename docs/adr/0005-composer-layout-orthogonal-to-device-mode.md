# Composer Layout is an override layer over Device Mode, not a replacement

The **Composer Layout** (user-authored arrangement + per-control color, title
visibility, and later button style) and the **Composer Device Mode**
(`modular-cream` / `modular-metal` — the prebuilt chassis aesthetic) are
**orthogonal axes that compose**, not one subsuming the other. Device Mode
stays the global base skin (chassis material, screen treatment, default key
look); Composer Layout positions controls in a bounded cell grid in the
controls strip and overrides per-control appearance on top. A control's
appearance resolves as **device-mode default → per-placement override**.

We chose this over folding everything into Layout data (where the device skins
become preset layouts) because the device skins are large, working CSS systems
delivering a premium hardware aesthetic; turning all of that into serialized
layout data is a full theming-as-data engine and a massive migration that
cannot ship as one phase. Composing on top lets the grid land without
discarding the skins, and we can migrate toward a unified model later if the
override layer grows to cover everything.

## Consequences

- Two styling axes coexist (skin defaults + layout overrides). The render path
  and the layout editor must compute and display the *effective* appearance
  (override wins), not just the raw override.
- The shipped default Composer Layout must reproduce today's control row
  pixel-faithfully under each Device Mode, or users perceive a regression when
  the layout engine replaces the hardcoded control row.
- Built-in controls and Chassis Actions become uniform **Composer Control
  Units** so the grid can position them; this is the slottable-unit refactor
  the Chassis Actions MVP deliberately deferred (see ADR 0004 / PRD #45).
- Some units are required (Send, Reasoning, Model): movable and restylable but
  never removable; a layout missing one has it auto-inserted.
