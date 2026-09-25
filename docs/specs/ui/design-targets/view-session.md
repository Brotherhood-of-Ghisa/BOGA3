# Accepted target — View Session (repo-native brief)

Target record per `../ai-design-policy.md`. Chosen by the user on 2026-09-23
(task card `T-20260923-02`, decision V1): a brief in this repository rather than
new artboards, because View Session is built almost entirely from primitives
the `exercise-session-v5.md` target already governs. **The detail's states
below were accepted by the user on 2026-09-24** (gallery iteration 1); the
completion's states join this record when they are accepted.

## Target

- Vocabulary: `exercise-session-v5.md` (`V6-Session` for the card and row) and
  `../design-language.md`.
- This brief, plus the gallery states the user accepts. No artboards.

## Brief

- One language with the session view: `paper` ground, `Card`s, the session
  view's set row (`type · weight × reps · 1RM · VOL`) and record band.
- The detail is read-only. Its one `accent` action is `Edit`, in the top bar
  where the session view's `Done` sits, so the `Edit` → `Done` loop reads as
  one place.
- Rare actions live behind ⋮s: Delete / Undelete on the session, Append on an
  exercise. The cards are not links.
- Start and End appear as the completed edit's fields show them
  (`YYYY-MM-DD HH:mm`), read-only.
- A deleted session says so in a band and offers no `Edit`.

## States

Device: iPhone simulator at 390pt width, light. Captured by the
`ios-ui-regression` lane (`session-completion-states-fixture.yaml`):

| Screenshot | State |
| --- | --- |
| `view-session-detail` | summary card and the first exercise card, with a record band |
| `view-session-exercise-options` | an exercise's ⋮ sheet (`Append to current session`) |
| `view-session-options` | the session ⋮ sheet (`Delete session`) |
| `view-session-deleted` | the deleted band, no `Edit` |
| `view-session-not-found` | not found, with the top bar's back |
| `completed-edit-read-back` | the detail after the session view's `Done` |

Completion (PR B, pending acceptance), same lane and flow:

| Screenshot | State |
| --- | --- |
| `session-completion-one-pr` | top bar, summary card with muscle pills, one record card |
| `session-completion-multiple-prs-all` | two record cards |
| `session-completion-exercise-volume` | volume cards: distribution and no-history |
| `session-completion-catalog-error` | muscle breakdown unavailable |
| `session-completion-unmapped` | no mapped working sets |
| `session-share-preview-all-prs` | the share sheet and image |
| `session-share-image-error` | the share sheet's inline failure |
| `session-completion-unavailable` | not found: top bar without Done, `Back to Progress` |

Group session view (PR C, pending acceptance): `groups-07-friend-view-read-only`
(`ios-groups-e2e`, `groups-two-user-stream.yaml`) — the member, status and
facts card, then the exercise cards; the group state panels keep the groups
screens' styling.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.

## Session Summary integration (PR #336)

The existing card/type/colour target above governs this integration; PR #336's
read-first History entry and local exercise/muscle switch govern its behavior.
The shared body uses the canonical `SegmentedControl` and volume cards. In the
live view it follows the logging cards and Add exercise, preserving their
hierarchy. Historical View Session consolidates the review sections as specified below.
Share remains exercise-only.
Verification states: `session-summary-muscle`, `session-summary-exercise`,
`session-live-muscle-comparison`, plus the completion/share captures above.

## Historical Summary / Sets (2026-09-25)

Accepted source: the user-invoked `historical-session-summary-in-view` repo-native
brief, extending this target with the captured pre-change Summary and Sets.
The existing cards, tokens and chart styling remain the visual authority.

- One `back · View Session · ⋮ · Edit` bar and one facts card (Start/End,
  Duration/Gym/Sets/Volume), followed by `Summary | Sets`, initially Summary.
- Summary: existing working-set breakdown, records, `By exercise | By muscle`
  comparisons and Share. Sets: existing read-only exercise cards and ⋮ actions.
- Section/grouping choices remain local across Edit → Done; facts, sets and
  comparisons refresh. No historical View individual sets or bottom Edit button.
- Historical Back returns once to its origin. Default and legacy Summary links
  use this view. Completed Edit has no charts; active and post-Finish flows keep
  their existing charts and completion exit behavior.
- Loading/failed comparisons stay explicit while facts, Sets and actions work.
  No-history/baseline, unmapped, empty/missing and deleted controls are retained.

Runtime comparison states (`ios-ui-regression`, `session-completion-states-fixture`):
`view-session-summary-top`, `session-summary-exercise`, `session-summary-muscle`,
`view-session-sets`, `completed-edit-session-view`, `completed-edit-read-back`,
`view-session-summary-after-edit`, `view-session-insights-loading`,
`view-session-insights-error`, `view-session-no-history`, `view-session-unmapped`,
`view-session-deleted` and `view-session-not-found`. Reference/after captures
stay under `apps/mobile/artifacts/maestro/`; the PR records viewport and comparison.
