# Optional bodyweight calculations — accepted implementation target

**Status: repo-native brief accepted; implementation and hands-on acceptance
pending.** Existing reference captures govern the established visual recipes,
not their retired bodyweight copy or controls.

This target supersedes the session bodyweight card/link, kg/lb selectors,
movement-standard/loading-method fields, bodyweight-specific metric boards,
calculation breakdowns and `Added`, `External weight` or `Effective load`
vocabulary. No external design service is required.

## Target and authority

- Settings structure: [More and Settings](more-settings.md).
- Exercise editor: [catalogue and editor](exercise-catalogue.md).
- Logger/records: [exercise/session](exercise-session-v5.md).
- Session/history structure: [View Session](view-session.md).
- Group administration and boards: current [group recipes](../ux-rules.md).
- Behavior/calculation: [bodyweight contract](../../tech/bodyweight-load-contract.md).
- Shared tokens, fields, sheets, lists and accessibility:
  [design language](../design-language.md), [UI rules](../ux-rules.md) and
  [design policy](../ai-design-policy.md).

## Brief

- Settings keeps `Bodyweight calculations` and its On/Off control together,
  followed by a separate, always-visible `Body weight log` link. The log link
  does not depend on the calculation preference.
- `Body weight log` is a kg-only dated history with add/edit/delete. It is the
  only bodyweight entry surface. No workout/session screen shows a reading,
  prompt, card, warning, action or dialog.
- The personal exercise editor conditionally adds only `Bodyweight contribution
  (%)` with a short hint. Hidden state preserves the value. The group setting
  and group exercise editor use the analogous admin-only toggle/field.
- The logger is unchanged structurally: `Weight`, reps, effort and confirm.
  Rows, records, History, Stats, completion and share use `Top weight`, `1RM`
  and `Volume`; bodyweight arithmetic stays invisible.
- A missing personal reading produces ordinary-looking numeric output through
  the zero fallback. Zero Weight/Volume/1RM renders `0`, not an unavailable
  state, and earns no record treatment.
- A strict group-derived score may be absent, but group UI uses generic
  `No eligible 1RM`/empty-board language. It must not reveal or imply a member's
  missing/invalid reading, value, date, source or history. Raw shared Weight,
  reps and sets remain readable.

## Flows and required rendered states

| Flow | Trigger and steps | Success | Failure / edge evidence |
| --- | --- | --- | --- |
| Toggle private calculations | Settings → toggle on → inspect row → off → on | Editor contribution visibility follows the toggle; `Body weight log` remains available and saved values return unchanged | Offline toggle persists locally; no destructive warning |
| Manage kg readings | Settings → `Body weight log` with calculations either off or on → add/edit/delete dated kg reading | Current/history list updates and affected projections refresh | Empty history; blank/zero/negative/nonfinite/future input; failed save retains input |
| Configure contribution | Enable private mode → create/edit exercise → enter 0–100% | One contribution field saves and later drives calculations | Decimal/range validation inline; disabled mode hides but preserves value; no extra fields |
| Log ordinary set | Mode off or contribution 0 → enter or omit Weight → reps → confirm | Weight/1RM/Volume use ordinary kg math; blank becomes zero | Invalid numeric input cannot commit; no reading prompt or bodyweight copy |
| Log aware set | Mode on + positive contribution → log with and without an applicable reading | Reading participates silently when present; missing uses the personal zero fallback | No warning/incomplete label; zero values remain numeric; raw Top weight stays unchanged |
| Review history | Change toggle/contribution/reading → revisit records, History, Stats and completion/share | Derived 1RM/Volume reinterpret; raw rows and Top weight do not | Refresh failure keeps prior content plus normal retry; zero creates no record band |
| Control group calculations | Group admin → toggle on → edit contribution → off/on | Whole group revision rebuilds; contribution survives | Member controls disabled/absent; failed online write retains form; rebuilding shows no mixed revision |
| Review group result | Open Weight/1RM boards and a shared set with/without member context | Raw Weight remains; eligible 1RM can rank/certify | Generic absent-score state only; no private reading facts or dependency digest anywhere |

## Reference captures

These committed captures preserve layout, typography, spacing, list/card and
logger recipes. Their old labels, unit controls, session bodyweight surfaces and
group metric choices are explicitly not part of this target.

| Reference | Recipe retained |
| --- | --- |
| [Settings](bodyweight/settings-reference.png) | Settings row rhythm and section hierarchy |
| [View Session](bodyweight/session-reference.png) | Session facts/cards after the bodyweight card is removed |
| [Exercise editor](bodyweight/editor-reference.png) | Form spacing and inline validation |
| [Logger](bodyweight/logger-reference.png) | In-place Weight/reps/effort/confirmation structure |
| [Group board](bodyweight/board-reference.png) | Existing Weight/1RM board, podium and list hierarchy |
| [Groups target](groups.md) | Group exercise list, edit entry, boards and state recipes |

## Verification and human hold point

Render the private Settings row, kg history, enabled/disabled personal editor,
ordinary and aware logger/records, group setting and group editor at 375×667pt,
402×874pt and 440×956pt. Include off/on/off/on persistence, missing personal
reading fallback, numeric zero and strict group absent-score states. Compare
against the recipes above, record device/viewport and material deviations in the
PR, and keep runtime captures under the gitignored Maestro artifact tree.

The user must exercise and explicitly accept the integrated interaction/design
direction before the aggregate closeout suite. Any later material UI change
returns to this hold point.
