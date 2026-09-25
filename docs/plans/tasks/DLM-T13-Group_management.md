---
task_id: DLM-T13-Group_management
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/ui/design-targets/groups.md"
---

# DLM-T13 Group management

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T11.
- Design target: extends `design-targets/groups.md`.
- Files (1,473 lines):
  - `app/group/{mine,join,new}.tsx`;
  - `app/group/[groupId]/{index,invite,members,edit}.tsx`;
  - `components/groups/{member-row,group-summary-row,group-action-sheet,member-action-sheet,group-details-form,username-gate}.tsx`;
  - its files stop using the `groupFormStyles` half of `screen-styles.ts`. T14's
    files (`exercise-link`, `group-exercise-form`, the pick sheet, the standard
    picker) still use it, so **the last of T13/T14 to land deletes it**.
- `GroupActionSheet` is also T14's exercise-actions sheet. Restyling it here
  changes that sheet too, which is intended.

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| **My groups**: Join (secondary) + **Create (primary)** row; offline, inline error; `GroupSummaryRow` cards (name, 2-line description, "N members · role") | Join outline + Create `accent`. One `Card` of `ListRow`s: name Archivo 600, description `ink-muted`, meta as a micro-label, `chevron-right` (`group-mine-list` kept) |
| **Join**: username gate or form card "Invite code" + input (`textDisabled` placeholder) + notice + "Find group" (secondary); preview card + **Join group / Open group (primary)** | `FormField` "Invite code" (Plex Mono input, since codes are figures). "Find group" outline; preview `Card` with `Join group` `accent` |
| **New / Edit**: `GroupDetailsForm` card: name (limit in label), input, error; description multiline, **counter `n/280`**; notice; **submit (primary)** | Two `FormField`s (the counter as the field's hint, mono); `Notice tone="danger"`; submit `accent`. testIDs `group-form-*` kept |
| **Username gate**: card, title, body, notice, "Username" input + error, **Save username (primary)** | A `Card` + `FormField` + `accent` (`group-username-gate/-input/-save` kept) |
| **Group screen** `[groupId]/index`: name, description; members link (meta + chevron); owner/admin **Invite (primary) + Edit (secondary)**; offline, error; "Exercises" header; `GroupExercisesPage` (with its own **Add exercise (primary)**) | Header `Card`: name, description, then a `ListRow` members link (`group-screen-members-link` kept). See **T13-D1** for the primaries. Edit outline. "Exercises" as a section micro-label. (The page contents are T14) |
| **Invite**: card: title, body, the code in **`Menlo` at `xl*2`**, link; feedback **success** notice ("New code ready…"); **Share invite (primary)**, **Regenerate (danger)** (Alert confirm) | The code in Plex Mono 700 at `xxl` (letter-spaced); link `ink-muted`; `Share invite` `accent`; `Regenerate code` outline `tone="danger"`; the feedback as `Notice` + `circle-check`. `group-invite-code` kept |
| **Members**: name, meta, feedback (**success** / error), offline, error; a `UiSurface` list of `GroupMemberRow` (name + "(you)", **role badge** pill, chevron when actionable); **Leave group (danger)** or the owner's note | Header as the group screen. `Notice`s. One `Card` of `ListRow`s: name, `Tag` role, a chevron only when actionable. `Leave group` outline `tone="danger"`. testIDs kept (`group-members-list`, `group-member-row-*`, `-action-feedback`, `-meta`) |
| **`GroupActionSheet`** (members and exercises): RN `Modal` (fade), scrim `<prefix>-overlay`, panel `<prefix>-sheet` (top radius `md`), title, subtitle, one button per action (danger when destructive, else secondary), **Cancel `<prefix>-cancel`** | A `Sheet` (G5): title and subtitle, one `ListRow` per action (`tone="danger"` when destructive), no Cancel. `<prefix>-sheet` and `<actionPrefix>-<key>` kept; `-overlay` → `-backdrop`. The `Alert.alert` confirms after an action (their labels "Remove" etc. are tapped by Maestro) are unchanged |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| **T13-D1** | The group screen shows **two primaries** to owners and admins: `Invite` and `Add exercise` | **`Invite` stays the primary; `Add exercise` becomes outline** in the Exercises section header. The group screen is "for managing the group" (`ux-rules` §14.10), and inviting is its headline action. The alternative, `Add exercise` primary, fits if you see the page as mostly exercises |
| T13-D2 | `GroupActionSheet` loses Cancel (G5) | Yes. `groups-write-screens.test.tsx:512,515,525` press `group-member-actions-cancel` → press `-backdrop`. No Maestro flow uses `-cancel` or `-overlay` (measured) |
| T13-D3 | The invite code's typeface: Menlo today | Plex Mono (the figure face) |

## UX contract

- **Create a group.** Trigger: `Create group`. Steps: username gate if blank →
  name, description → submit. Success: the group screen. Edge: validation
  inline; offline refused (pattern 9); a server `USERNAME_REQUIRED` re-opens the
  gate with a notice and keeps the values.
- **Invite.** Trigger: `Invite`. Success: the code and link; `Share invite`
  opens the share sheet; `Regenerate` confirms, then "New code ready…". Edge:
  offline refused.
- **Manage members.** Trigger: an actionable member row. Success: the sheet
  offers exactly `groupMemberActionsFor`; destructive ones confirm natively; the
  notice reports the outcome. Edge: `FORBIDDEN` / `NOT_FOUND` inline and a
  refresh.
- **Leave.** Trigger: `Leave group` → confirm. Success: back to My groups.
  Edge: the owner sees "Transfer ownership before leaving".

## Gallery

`groups-two-user-stream`: `groups-01-username-prompt`,
`groups-02-group-created`, `groups-03-invite-code`, `08-counterparty-removed`,
`09-removed-member-not-found`.

**New** (asserted, where the flow already passes):

- `groups-members-list` at `group-members-list` (:815);
- `groups-member-actions-sheet` at `group-member-actions-sheet` (:821);
- `groups-mine-list` at `group-mine-list` (:153).

Join, New (the empty form) and Edit are not reached by any flow. The
counterparty joins by script. They stay jest-only, listed as such.

## Tests

- `groups-write-screens.test.tsx`: Cancel presses → backdrop (T13-D2).
  Otherwise behaviour is unchanged.
- `groups-join-deep-link.test.tsx`, `groups-screens.test.tsx`: green.

## Docs

- `screen-map.md` 13–18.
- `ux-rules.md` §14.8–9 (sheets without Cancel).
- `components-catalog.md` (`GroupActionSheet`, `GroupMemberActionSheet`,
  `GroupMemberRow`, `GroupSummaryRow`, `GroupDetailsForm`, `UsernameGate`).
- `design-targets/groups.md`.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the listed files, and none of them imports
   `groupFormStyles`.
2. At most one `accent` on the group screen for every role (jest).
3. Gallery accepted.
4. Estimate: about 1,200 lines.
