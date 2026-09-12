# M24 - Current-session Insights and PR Celebration

## Milestone metadata

- Milestone ID: `M24`
- Title: Current-session insights and PR celebration
- Status: `in_progress`

## Parent references

- Project directives: `AGENTS.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing and gates: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- UX standard and current UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Project structure: `docs/specs/09-project-structure.md`
- Existing analytics and recorder behavior:
  `apps/mobile/src/data/muscle-analytics.ts`,
  `apps/mobile/app/(tabs)/session-recorder.tsx`,
  `apps/mobile/app/completed-session/[sessionId].tsx`

## Milestone objective

Give a person meaningful feedback while they train and a satisfying moment when
they finish, without adding another top-level destination. The active recorder
shows current-session muscle load after the first valid confirmed set. A new
personal record remains attached to the exercise that produced it. After a
successful submission, a screenshot-friendly completion presentation leads
with any PRs, follows with the session's muscle-load summary, and offers one
direct handoff to the existing seven-day muscle analysis.

## Boundary decisions

1. **Two signals keep two scopes.** A PR is exercise-specific. Muscle load is a
   session-wide aggregate. They may appear after the same set confirmation, but
   they are never combined into one score or placed in a new tab.
2. **No premature empty state.** Before the first valid confirmed performed set,
   the recorder contains no muscle-load row and no copy such as "Confirm a set
   to see muscle load." The existing confirmation control is sufficient.
3. **Current session is not a history period.** The recorder and completion
   presentation use a dedicated current-session summary. The 7-/30-day controls
   and calendar heatmaps remain historical analysis; M24 does not add "Current
   session" as a heatmap range.
4. **One canonical calculation contract.** Current-session muscle load reuses
   the existing per-side, role-weighted muscle contribution semantics. PRs reuse
   the existing performed-set parsing and Wathan estimated-1RM calculation.
5. **PR means strict improvement over prior history.** A PR requires a valid
   confirmed set whose estimated 1RM is strictly greater than the best eligible
   completed, non-deleted history for the same exercise definition. A first-ever
   performance with no historical baseline is not labelled a PR in M24.
6. **Celebration is derived, not persisted.** M24 adds no `is_pr`, achievement,
   or session-summary columns. The just-completed session and its earlier
   history are sufficient to derive the completion presentation. Historical
   session detail continues not to claim that a workout was a PR.
7. **Completion is a presentation mode, not a new tab.** Active-session submit
   opens the existing completed-session route with an explicit completion
   presentation query. Completed-session editing keeps its current return to
   Stats / History and does not replay the celebration.
8. **Sharing stays lightweight.** Each PR card is visually complete for a phone
   screenshot and offers the platform text share sheet. M24 does not generate a
   branded image, upload media, publish to a social network, or add deep links.

## Product and UX contract

### Live muscle-load signal

- The compact `Session muscle load` row sits outside exercise cards, directly
  above recorder-wide actions.
- It appears only after at least one valid confirmed performed set exists.
- Its summary reports:
  - number of contributing muscle groups;
  - total valid confirmed performed sets in the session;
  - working-set count in parentheses;
  - the leading contributing muscles in descending weighted volume.
- Set counts are physical source-set counts and are not multiplied when one set
  maps to more than one muscle.
- Tapping the row opens an in-route sheet listing every contributing muscle,
  sorted by weighted volume with taxonomy order as the stable tie-breaker.
- Each muscle row shows exact weighted volume and a relative bar. Bars compare
  muscles only within this session; they are not fatigue, recovery, readiness,
  prescription, or target indicators.
- Confirming, editing, unconfirming, or deleting a set updates the summary from
  current in-memory recorder state without a write beyond existing autosave.
- If valid confirmed work exists but none of it has an eligible muscle mapping,
  the row renders `No mapped muscle load` and the sheet explains that the
  performed exercises do not currently contribute to muscle analytics. This is
  distinct from the intentionally absent pre-confirmation state.
- Catalog/mapping load failure renders a compact unavailable state with Retry;
  it never blocks set entry, autosave, or submission.

### Exercise-level PR moment

- The existing live PR classification remains in the exercise card that owns
  the qualifying set, in both expanded and collapsed states.
- M24 upgrades it to a clearly celebratory `New PR` treatment that includes the
  exercise-local best set and estimated 1RM. The expanded card also exposes a
  `Share PR` action; the collapsed title toggle remains free of nested controls.
- The state persists while the qualifying confirmed work remains in the active
  recorder. If the set is edited below the historical best, unconfirmed, or
  removed, the PR treatment disappears immediately.
- Multiple exercises can independently show a PR. Multiple qualifying sets for
  one exercise produce one card summary using that exercise's best current set.
- The share payload is concise text containing exercise name, entered weight,
  reps, and rounded estimated 1RM. Cancelling the platform sheet is a no-op;
  launch failure stays inline and retryable.

### Completion presentation

1. A successful active-session submit persists and completes the session using
   the existing flow.
2. Instead of immediately replacing to Stats / History, the app replaces to:

   ```text
   /completed-session/<sessionId>?presentation=completion
   ```

3. The top of that presentation uses this hierarchy:
   - `Session complete` and compact duration/exercise/set context;
   - `Personal records`, only when one or more PRs exist;
   - one screenshot-ready PR card at a time, in session exercise order, with a
     stable `N of M` control when the session contains multiple PRs;
   - `Session muscle load`, using the same summary as the recorder;
   - `View 7-day muscle load`;
   - `Done`.
4. With no PR, the entire PR section is absent and muscle load becomes the first
   insight. No congratulatory placeholder is shown.
5. With confirmed but unmapped work, the completion muscle card uses the same
   `No mapped muscle load` explanation as the recorder.
6. `Share PR` invokes the same platform share behavior as the recorder.
7. `View 7-day muscle load` replaces to:

   ```text
   /stats-history?period=7&breakdown=muscle
   ```

   The Stats / History route validates these optional query values, selects the
   seven-day muscle breakdown, and leaves its existing heatmap interaction
   unchanged.
8. `Done`, the system back action, and an invalid/unavailable completion target
   all return safely to `/stats-history`; none can resurrect the completed
   recorder draft.
9. Normal entry to `/completed-session/<sessionId>` from history retains the
   existing detail presentation and edit/delete/append actions. The completion
   query changes presentation only, not the stored session.

## Calculation contract

### Session muscle load

M24 adapts the active or target session graph into the existing
`MuscleAnalyticsInput` shape and reuses `collectMuscleSetContributions(...)`,
`countMuscleAnalyticsPerformedSets(...)`, and
`countMuscleAnalyticsWorkingSets(...)` or a shared extraction of those exact
semantics.

- Eligible sets are valid, confirmed, performed sets.
- Confirmed warm-up sets contribute to volume and performed-set count.
- Working-set count includes only the existing working set types.
- Entered total load is divided by two before muscle-role weighting;
  `per_side_load` is not divided again.
- Primary role factor is `1`, secondary is `0.5`, and stabilizer/null is `0`.
- Exercise definitions and muscle mappings use the current catalog metadata,
  matching the product's retroactive metadata decision.
- A muscle's value is the sum of its weighted set contributions. The number of
  contributing muscles includes only positive contributions.
- Session bars normalize against the largest positive muscle value in the same
  session; exact values remain visible and accessible.

### Completion PR derivation

- The target is the just-completed, non-deleted session.
- Historical baselines include eligible completed, non-deleted sessions ordered
  before the target by `(completed_at, session_id)` and exclude the target.
- Comparison is by stable `exercise_definition_id`; session-local exercises
  without that identity cannot produce a PR.
- Both target and history use valid confirmed performed sets and the existing
  Wathan estimated-1RM helper.
- The target's best set must be strictly greater than the historical maximum.
- Results deduplicate by exercise definition and follow target session exercise
  order. Ties within one exercise use set order, then stable set ID.
- The live recorder and completion presentation must share the same pure PR
  comparison helper so the signal cannot change because two screens implement
  different arithmetic.

## Data model and sync impact

`out of sync scope`.

M24 is derived UI over the existing session, exercise, set, exercise-definition,
muscle-mapping, and muscle-group rows. It adds no user-authored entity, durable
preference, backend projection, RLS rule, RPC, or sync envelope field. Sharing
uses an ephemeral text payload and stores nothing.

If implementation introduces a durable achievement, cached insight, share
receipt, generated media, or new route-state persistence, that task must reopen
the data-model and sync decision and update `docs/specs/05-data-model.md` plus
the relevant sync contract in the same change.

## In scope

- Pure current-session muscle summary and PR-achievement derivation shared by
  recorder and completion presentation.
- Compact recorder muscle-load row and detailed in-route sheet.
- Clear, persistent exercise-level `New PR` treatment and text sharing.
- Completion presentation mode on the existing completed-session route.
- Optional validated Stats / History deep-link query for the seven-day muscle
  breakdown.
- Loading, unavailable, no-PR, unmapped, multiple-PR, share-cancel, share-error,
  and set-reversal behavior.
- Focused unit/integration coverage, Maestro coverage, visual evidence, and
  canonical UI documentation updates.

## Out of scope

- Splitting Stats / History into new Logs and Analytics tabs.
- Adding a Current session period to history heatmaps.
- New PR, achievements, analytics-cache, or share-history storage.
- Reclassifying a first-ever performance as a PR.
- PR certification, group competitions, leaderboards, reactions, or social
  feeds.
- Generated share images, watermarking, deep links, or direct social posting.
- Recovery, fatigue, readiness, injury-risk, coaching, or target recommendations.
- Changes to muscle contribution factors, load-input semantics, the Wathan
  formula, or set confirmation semantics.
- Replaying the completion celebration after completed-session edits or during
  ordinary history browsing.

## Deliverables

1. Shared session-insight calculation and repository adapters with deterministic
   tests for muscle summaries and as-of-session PRs.
2. Live recorder muscle-load row and inspection sheet.
3. Exercise-level PR celebration and platform text sharing in the recorder.
4. Completed-session completion presentation with PR ordering, muscle summary,
   sharing, Done behavior, and seven-day muscle-analysis handoff.
5. Updated route/component/UX documentation, integration and Maestro coverage,
   screenshot evidence, and milestone closeout.

## Acceptance criteria

1. Before a valid set is confirmed, the recorder shows no muscle-load row and
   no instructional empty-state copy.
2. The first valid confirmed set reveals a session-wide muscle summary; later
   confirm/edit/unconfirm/delete operations update it immediately.
3. Current-session muscle values match the existing history analytics semantics
   for the same session graph, including load mode, role weighting, warm-ups,
   working sets, and physical-set deduplication.
4. Tapping the compact row opens a dismissible in-route sheet with every
   contributing muscle, exact accessible values, and relative session-only bars.
5. Confirmed work with no eligible mapping shows the explicit unmapped state;
   catalog failure is retryable and never blocks recorder actions.
6. A live PR appears only for a strict estimated-1RM improvement over an
   existing completed-history baseline and disappears when its qualifying work
   no longer meets that rule.
7. PR feedback remains inside the owning exercise card while muscle load remains
   outside all exercise cards.
8. Each PR can open a platform text share sheet from the expanded exercise card
   with the correct exercise, load, reps, and rounded estimated 1RM;
   cancellation is silent and failure is retryable.
9. Successful active-session submit opens the existing completed-session route
   in completion presentation mode and cannot return to an active copy of the
   completed draft.
10. Completion hierarchy is PR achievements (when any), session muscle load,
    then the seven-day analysis handoff. With no PR, no PR placeholder appears.
11. Multiple PRs are ordered by session exercise order and can be viewed/shared
    one at a time with an accessible position indicator.
12. `View 7-day muscle load` opens Stats / History with seven days and By Muscle
    selected; invalid query values fall back to existing defaults.
13. Normal completed-session history entry and completed-edit save keep their
    current non-celebratory behavior.
14. No schema, migration, backend, RLS, sync, or new native dependency change is
    introduced.
15. Shared UI tokens/primitives are used; no raw color literals are introduced
    in route/component `.tsx` files without an explicit documented exception.
16. Focused tests cover calculation boundaries and every key UI state; the
    required `./boga test fast` and `./boga test frontend` gates pass.
17. Visual evidence includes pre-confirmation, live mapped load, unmapped/error,
    one and multiple PRs, no-PR completion, PR completion, share launch, and the
    seven-day muscle handoff on supported small and large phone viewports.
18. `screen-map.md`, `navigation-contract.md`, `components-catalog.md`, and
    `ux-rules.md` describe the shipped routes, states, semantics, and reusable
    components.

## Task breakdown

1. `docs/plans/tasks/M24-T01-Session_insight_calculation_contract.md` - build the
   shared current-session muscle and as-of-session PR derivation with unit tests.
   (`completed`)
2. `docs/plans/tasks/M24-T02-Live_recorder_muscle_load.md` - add the compact recorder
   muscle-load row, detail sheet, and edge states. (`completed`)
3. `docs/plans/tasks/M24-T03-Exercise_PR_celebration_and_sharing.md` - upgrade the live
   exercise PR treatment and add platform text sharing. (`completed`)
4. `docs/plans/tasks/M24-T04-Completion_summary_and_analytics_handoff.md` - add the
   completion presentation, multiple-PR handling, and seven-day muscle deep
   link. (`planned`)
5. `docs/plans/tasks/M24-T05-Milestone_closeout.md` - run merged-flow QA, capture
   evidence, reconcile canonical docs, and archive M24. (`planned`)

## Dependencies and sequencing

- `M24-T01` lands first.
- `M24-T02` and `M24-T03` both depend on `M24-T01`. They should land
  sequentially because both touch the recorder composition.
- `M24-T04` depends on `M24-T02` and `M24-T03`.
- `M24-T05` depends on all implementation tasks merged.

Suggested branch names:

- `codex/m24-t01-session-insight-calculations`
- `codex/m24-t02-live-muscle-load`
- `codex/m24-t03-pr-celebration-sharing`
- `codex/m24-t04-completion-summary`
- `codex/m24-t05-closeout`

## Testing and verification expectations

Implementation tasks add focused Jest/RNTL coverage before the aggregate gates.
Any task changing mobile UI or navigation runs:

```bash
./boga test fast
./boga test frontend
```

Required automated coverage includes:

- zero/one/many confirmed sets and confirmation reversal;
- mapped, partially mapped, unmapped, and catalog-error sessions;
- source-set counts across exercises with multiple muscle mappings;
- total-load versus per-side-load volume;
- primary, secondary, stabilizer, and null role behavior;
- warm-up volume versus working-set count;
- strict PR, equal-to-best, below-best, no-baseline, deleted-history, duplicate
  exercise-definition blocks, and deterministic tie behavior;
- recorder PR and muscle-load visibility in expanded/collapsed states;
- share success/cancel/error behavior with a mocked platform boundary;
- completion-mode query parsing, normal-detail preservation, no-PR and
  multiple-PR states, safe Done/back behavior, and seven-day muscle handoff;
- invalid Stats / History query fallback.

Maestro must cover one representative golden path:

1. start a session with seeded history and mappings;
2. confirm a non-PR set and inspect live muscle load;
3. confirm a strict PR and see exercise-level celebration;
4. submit and see the PR-first completion hierarchy;
5. open the share sheet without sending externally;
6. open the seven-day By Muscle view.

The milestone does not require backend gates unless an implementation task
reopens the declared no-schema/no-sync boundary. Durations are reported only
from `./boga timings` or gate records.

## Docs maintenance expectations

- `docs/specs/ui/screen-map.md`: recorder live muscle-load and PR states;
  completed-session completion presentation; Stats query-driven initial state.
- `docs/specs/ui/navigation-contract.md`: completion query, submit transition,
  Done/back behavior, and validated Stats `period`/`breakdown` query values.
- `docs/specs/ui/components-catalog.md`: reusable session-insight, muscle-load,
  and PR-card components that implementation introduces.
- `docs/specs/ui/ux-rules.md`: two-scope signal rule, progressive reveal,
  relative-bar semantics, PR criteria, completion hierarchy, and share behavior.
- `docs/specs/08-ux-delivery-standard.md`: update only if implementation creates
  a genuinely reusable cross-feature pattern.
- `docs/specs/00-product.md`: record the shipped product decision during
  closeout, not while behavior is only planned.
- `docs/specs/05-data-model.md` and the sync contract: no update expected unless
  implementation violates the declared derived-only boundary.

## Risks / dependencies

- The recorder already derives live PRs from loaded exercise history. T01 must
  remove arithmetic duplication without regressing the existing Past Records
  panel or making recorder input wait for history loading.
- A set mapped to several muscles can inflate naive set totals. The summary must
  count stable physical set identity independently from contribution rows.
- Current metadata is retroactive. Editing an exercise's mapping can change a
  later recomputation of the completion muscle summary; M24 does not snapshot
  mappings.
- Completion PR derivation is intentionally as-of-session and deterministic,
  but completed-history edits can change what a later forced completion URL
  derives. The route is a just-completed presentation, not a durable award log.
- The completion view must fit its primary PR card on the smallest supported
  phone without truncating the facts users want to capture.
- Native share sheets are outside React Native rendering tests. Maestro verifies
  launch and safe return but never sends a message or posts externally.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state.
- Move completed task cards to `docs/plans/tasks/` and update references.
- When all acceptance criteria are evidenced, move this milestone to
  `docs/plans/milestones/` and update `docs/specs/README.md`.
