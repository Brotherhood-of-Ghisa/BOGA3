# Routine control comparison — SwitchRow selected

The operator accepted the idea on 2026-11-06 and asked whether the tick follows
BoGa design and whether other BoGa-style options exist. This accepts the plan
property concept. The operator subsequently selected **Switch row
(recommended)** and requested a visually explicit locked Anytime value.

## Existing component choices

| Choice | Actual existing parent | Fit |
| --- | --- | --- |
| Tick | CheckRow in `apps/mobile/components/ui/form-rows.tsx`; used in `apps/mobile/components/preferences/effort-settings.tsx` | Quiet row with the accent check while selected. No glyph while off makes the affordance less obvious. The v2.1 mock's text tick must use the actual Icon check instead. |
| Switch — recommended | SwitchRow, `density="list"`, in `apps/mobile/components/ui/switch-row.tsx`; Uses bodyweight in `apps/mobile/components/exercise-core/exercise-core-fields.tsx` | Closest semantic match for one boolean property, with visible on/off states. Same card and plan identity. |
| Two segments | SegmentRow / SegmentedControl; existing form/Settings vocabulary | One-off / Routine states are explicit, but the row takes more room and presents the property as a more prominent mode choice. |

Comparison source: `docs/plans/designs/routines-control-options.html`.
Served mock copy and evidence: `apps/mobile/artifacts/routines-anytime/v2/`.

## Captured review

1. Enabled state — all three controls indicate Routine; Schedule is disabled
   and reads Anytime. Captured in `control-options-on.png` from the in-app
   browser and the saved file inspected. Geometry, fonts and colour use the
   repository vocabulary; the tick path is the actual BoGa check geometry.
2. Off state — Show off changes each accessible control state, removes the
   tick, moves the switch and selects One-off. Schedule regains its date and
   enabled state. Captured in `control-options-off.png` and the saved file
   inspected. The absent tick demonstrates the off-state affordance tradeoff.

The comparison was returned to the enabled state and left open for selection.
These are planning representations, not captured production components. The
switch is represented in HTML; its native rendering and actual VoiceOver/touch
behavior remain for the running-app review. No full accessibility audit or
implementation gate is claimed.

SwitchRow is selected. The updated target is
`docs/plans/designs/routines-anytime-v3.md`, using SwitchRow plus ValueRow for
the locked schedule. It adds no new primitive or typography/density override.
