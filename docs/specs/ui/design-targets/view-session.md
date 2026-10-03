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
`ios-data-smoke` lane (`session-completion-states-fixture.yaml`) unless
marked ad hoc:

| Screenshot | State |
| --- | --- |
| `view-session-detail` (ad hoc) | summary card and the first exercise card, with a record band |
| `view-session-exercise-options` (ad hoc) | an exercise's ⋮ sheet (`Append to current session`) |
| `view-session-options` (ad hoc) | the session ⋮ sheet (`Delete session`) |
| `view-session-deleted` (ad hoc) | the deleted band, no `Edit` |
| `view-session-not-found` (ad hoc) | not found, with the top bar's back |
| `completed-edit-read-back` (ad hoc) | the detail after the session view's `Done` |

Completion (PR B, pending acceptance), same lane and flow:

| Screenshot | State |
| --- | --- |
| `session-completion-one-pr` (ad hoc) | top bar, summary card with muscle pills, one record card |
| `session-completion-multiple-prs-all` (ad hoc) | two record cards |
| `session-completion-exercise-volume` (ad hoc) | volume cards: distribution and no-history |
| `session-completion-catalog-error` (ad hoc) | muscle breakdown unavailable |
| `session-completion-unmapped` (ad hoc) | no mapped working sets |
| `session-share-preview-all-prs` | the share sheet and image |
| `session-share-image-error` (ad hoc) | the share sheet's inline failure |
| `session-completion-unavailable` (ad hoc) | not found: top bar without Done, `Back to Progress` |

Group session view (PR C, pending acceptance): `groups-07-friend-view-read-only`
(`ios-groups-e2e`, `groups-two-user-stream.yaml`) — the member, status and
facts card, then the exercise cards; the group state panels keep the groups
screens' styling.

`(ad hoc)` states are no longer captured by a lane: their flow keeps only
the claims that need a device (spec 06, "Maestro scope policy") and Jest
proves the rest. When the screen changes, capture them with a one-off flow
run (`apps/mobile/scripts/maestro-ios-run-flow.sh --flow …`); git history
holds the flow steps that reached them.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.

## Session Summary integration (PR #336)

The existing card/type/colour target above governs this integration; PR #336's
read-first History entry and local exercise/muscle switch govern its behavior.
The shared body uses the canonical `SegmentedControl` and volume cards. In the
live view it follows the logging cards and Add exercise, preserving their
hierarchy. Historical View Session consolidates the review sections as specified below.
Share remains exercise-only.
Verification states: `session-summary-muscle`, `session-summary-exercise` (ad hoc),
`session-live-muscle-comparison` (ad hoc), plus the completion/share captures above.

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

Runtime comparison states (ad hoc): `completed-edit-session-view`,
`completed-edit-read-back`, `view-session-summary-top`,
`session-summary-exercise`, `session-summary-muscle`, `view-session-sets`,
`view-session-summary-after-edit`, `view-session-insights-loading`,
`view-session-insights-error`, `view-session-no-history`, `view-session-unmapped`,
`view-session-deleted-summary`, `view-session-deleted` and `view-session-not-found`.
Reference/after captures stay under `apps/mobile/artifacts/maestro/`; the PR
records viewport and comparison.

## Weight records (accepted 2026-10-03)

The session view, View Session and completion show the exercise's record set,
1RM else Weight (`../../tech/training-metrics-contract.md` §3), the same way
the exercise page does. The user accepted a repo-native mockup of states A–E
on 2026-10-03, with one change: the Weight band names the set.

- **A. Weight-only record on a session view card.** The record set's
  `weight × reps` is bold `record`. Its 1RM and Vol keep the row's colour. The
  band reads `New top weight · <weight> × <reps>`.
- **B. A 1RM record that also beats the Weight record.** Both figures are
  `record`, under one band, `New 1RM record · <1RM>`.
- **C. View Session (Sets).** The card is A's, with View Session's header.
- **D. Completion.** The Weight card has A's band and the set in `record`; its
  1RM stays in `ink`. A 1RM card whose set also beat the Weight record shows
  the set in `record` too.
- **E. Share image.** The list is headed `<n> new records`. Each line names its
  kind on the right (`1RM` or `Top weight`), in `record`, and its beaten
  figures are `record`.

The accessibility labels use the band words: `…, new top weight 100.0 × 3`,
and `New top weight for <exercise>: <set>, 1RM <1RM>`. No new role or token.
The integrated states were captured ad hoc on the simulator; the PR links
them.
