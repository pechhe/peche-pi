# Chassis Actions and Composer Layout scope app-global, not per-thread

A **Chassis Action**'s sticky on/off state and the **Composer Layout** are
scoped **app-global** for MVP, intended to become **per-project-folder
(workspace)** later — deliberately *not* per-thread, even though the prebuilt
composer toggles they generalize (plan/build, caveman, orchestrate) are all
per-thread.

We do this because a user's custom composer is a property of *how they like to
work*, not of an individual conversation: they configure their buttons and
(later) their grid once and expect it to be there in every thread. Per-thread
state — which is correct for the built-in toggles, where "plan mode" or
"caveman" is a momentary stance on one task — would force users to re-enable
their own tools in every new thread, which contradicts the "build your own
composer" intent. The natural next axis is the project folder (different
layouts per workspace), not the thread.

## Consequences

- A future reader will notice that built-in toggles live per-thread in
  `DesktopAppState` while Chassis Action sticky activation is app-global. This
  divergence is intentional — do not "fix" it by moving chassis state
  per-thread. The two have different lifetimes by design.
- Chassis Action *definitions* persist in `~/.pi/agent/chassis/state.json`
  (global). Sticky *activation* state lives in app-global desktop state for
  MVP; when the per-folder axis lands, activation and layout key off the
  workspace, never the thread.
- Built-in toggles are **not** migrated into the Chassis registry; they sit
  alongside it until the model is proven, so their per-thread scope is
  unaffected by this decision.
