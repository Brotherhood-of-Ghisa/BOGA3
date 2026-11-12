# UX Delivery Standard (v0)

> **Owns:** the UX delivery process, iteration loop, and evidence standard. **Not here:** concrete UI rules and inventories → `docs/specs/ui/`. **Load when:** any UI work.

## Scope and ownership

Applies to mobile UI screens, components and flows. This document owns shared
UX delivery process and patterns. For current app rules/inventory and their
maintenance triggers, load `docs/specs/ui/README.md`. For design targets,
external artifacts, generated-code integration and screenshot comparison,
load `docs/specs/ui/ai-design-policy.md`. Component code/tests own APIs and
screen behavior; UI docs summarize current reality without duplicating them.
Update this standard only for shared process or pattern changes.

## UX consistency and pattern management

1. Maintain a living `UX patterns` section in this document.
2. Reuse existing patterns by default before introducing new interaction/visual patterns.
3. If a task introduces a new pattern, updating the `UX patterns` section is required in the same task.
4. If a task intentionally deviates from an existing pattern, record rationale and impact in the PR body (Deviations).

### Select a design template before building

For a new UI block, show the applicable approved families from
`docs/specs/ui/components-catalog.md`, recommend one and record the selected
production export/variant before coding. Reusing an approved design template
within its bounded variants needs no fresh design acceptance. Carry existing
selections forward within their agreed scope.

A composition outside those templates, or a derivative beyond their allowed
variants, is **custom design**. Record its nearest parent and differences,
including inherited type, geometry and action boundaries. Custom UI follows
ordinary PR review with the required tests and visual evidence. It needs no
separate pre-build approval reference or specially formatted acceptance comment.

### Record and verify the choice

The existing guardrail lane requires one visible `ui-pattern-selection` JSON
code block in the draft/PR body for new or changed JSX/presentation under
app/components. It maps each affected source to `template` or `custom`, its
production parents and its delta. Existing compositions are established design:
comments, formatting and logic edits that preserve JSX and presentation values
need no declaration. The checker compares parsed JSX and presentation values;
reviewers judge visual materiality. Schema and failing/safe cases:
`apps/mobile/scripts/ui-pattern-selection.js` and
`apps/mobile/__tests__/ui-pattern-selection.test.ts`.

Before a PR exists, save that body at `apps/mobile/artifacts/ui-review.md`
(or set `BOGA_UI_REVIEW_BODY` to its path), then run normal gates. A template
parent must exist at the base and be imported/rendered from its real export;
template selections inherit existing family checks. CI verifies declarations;
reviewers verify truthful classification, scope and evidence. Custom declarations
do not require approval metadata. Template promotion has its own process below.

### Review custom coded results

Provide the running custom component/reference and native comparisons under
`docs/specs/ui/ai-design-policy.md`: small/normal widths, long content, relevant
states and owned actions; pair list/table rows when their rhythm changes.
Review this evidence in the normal PR process. An unrelated push does not
create a new design-acceptance step; refresh evidence when the design changes.
The `UI pattern review` check enforces declarations, template inheritance and
template promotion, never separate approval of custom-component use.

### Promote a design into a reusable template

A human **or agent** may propose promotion in the existing UX Contract and
`ui-pattern-selection` block. Shipping custom UI never promotes it to a reusable
template. Only a human with repository write/maintain/admin authority,
including the PR author, may accept promotion.

1. **Propose.** Add the proposed contract to the catalog's
   `ui-template-catalog` array: stable `id`, production `source`/`export`,
   intended `uses`, named `variants` with explicit bounds, `slots`,
   `typography`, `geometry`, `interactions`, `accessibility`, owned implementation
   `files`, representative `gallery` source/export and Jest `tests` paths.
   Include production and gallery sources in `files`. The inventory is the
   durable contract; acceptance evidence stays in the PR.
   In `ui-pattern-selection.promotions`, name the `id`, `whyExistingInsufficient`,
   `nearestParent` (existing family/source/export), `differences`,
   `visualReference` and `preBuildApproval` (human login/reference).
2. **Review before building.** Obtain explicit human acceptance of the proposed
   design **and template scope** before implementing novel production design.
   Carry valid earlier design evidence forward for an existing custom component,
   but obtain a separate promotion decision. Agents may prepare proposals,
   implementations and evidence; they must never fabricate or post acceptance.
3. **Implement and verify.** Build the production export, representative gallery
   examples using it, meaningful tests and native comparisons required by the
   design policy. The promotion's `evidence.native` lists references with
   `device`, `viewport` and `covers`: collectively `small`, `normal`,
   `content-extremes`, `states`, `interactions`, `accessibility`. Include long/empty
   content, each variant and relevant loading/error/disabled/selected states,
   wrapping/stacking and owned actions; explain inapplicable cases. Show shared
   row rhythm together. Record screenshots and behavior/accessibility results
   at the reviewed full commit. Changed UI still declares custom design;
   adding a catalog row cannot authorize its own reuse.
4. **Accept the running template.** After inspecting the implementation,
   contract and evidence, the authorized human posts this whole PR comment:

   ```text
   UI template accepted at <full-head-sha>:
   - <TemplateId> sha256:<digest>
   ```

   The existing checker prints the required id/digest when acceptance is missing;
   its `promotionDigest` hashes the catalog entry and complete promotion record
   deterministically. List each accepted promotion. Generic PR approval,
   proposal approval do not promote anything. This acceptance is specific to
   reusable-template registration; custom-component use has no separate gate.
   Every push invalidates acceptance; contract/proposal/evidence edits change
   the digest even without a push. Comment deletion/edit withdraws it. Renew
   evidence and human acceptance after implementation or scope changes.
5. **Register and activate.** Merge only after the existing `UI pattern review`
   check passes on the final head. The candidate catalog is parsed as data;
   only unchanged registrations already in the trusted merged base are eligible
   for reuse. Future template parents use `family: "catalog"` plus `template`
   id, `source`, `export`, accepted `use` and named `variant`. Style/spread overrides and mismatched/dynamic `variant` props fail reuse. Within
   those bounds reuse needs no renewed design acceptance. Outside them declare custom
   design for ordinary PR review; changing the reusable contract requires
   promotion again. Preserve production exports, catalog bounds and checker
   inheritance in the same change.

The checker verifies registration structure, real exports, gallery use, file
presence, declared bounds and authorized exact-head/digest comments. Humans
verify semantic fit, evidence quality, truthful pre-build authority/timing and
completeness of owned files. A reference is not independent proof of those facts.
GitHub User identity cannot distinguish a human from an agent using shared
credentials; agents must not use that limitation to post acceptance.

Installation uses the existing base-owned workflow and required check, never
candidate executables. If it is not yet installed/enforced on protected `main`,
activation is pending: merge the policy first, verify the check on a subsequent
PR, then require it in branch protection/rulesets. Stacked PRs must retarget the
merged `main` and pass its trusted check before merge. No new approval service
or generic approval-count requirement is introduced. For schema and fixture
examples, load `apps/mobile/scripts/ui-template-promotion.js` and
`apps/mobile/__tests__/ui-template-promotion.test.ts`.

## Required task-level UX contract

Before UI work, record the UX Contract in the task/plan or PR body, beside the
significant task's design target (`docs/specs/ui/ai-design-policy.md`). For each
flow state trigger, steps, success and failure/edge outcomes. Add at most five
interaction/appearance notes. Keep flow behavior here, not in duplicate
interaction/state sections. Closeout links tests and screenshots to those flows
and records deviations; update the owning UI documents when behavior changes.

## UX patterns

Use this section as the single source of truth for reusable UX patterns.

1. Seeded picker pattern
   - Intent: choose one item from a short static list with low friction.
   - Usage: location and exercise preset selection.
   - Rules: show current value, keep options human-readable, and confirm selection immediately in UI state.
2. Editable list row pattern
   - Intent: rapidly add/update/remove repeated entities in a form-like list.
   - Usage: exercises, sets, and user-added mock locations.
   - Rules: stable row identity, inline edit affordance, and explicit remove action.
3. Destructive action safety pattern
   - Intent: prevent accidental data loss in edit flows.
   - Usage: delete location/exercise/set actions.
   - Rules: clear destructive styling, confirm intent when risk is meaningful, and provide immediate feedback after action.
4. Collapsible summary card pattern (retired)
   - Retired with the View Session restyle: completed-session detail and a group member's session now draw read-only exercise cards (`components/session-detail/`, the cards of pattern 13 without the link) and nothing collapses a card. Kept as a numbered slot so later patterns keep their numbers.
5. Explicit row confirmation pattern
   - Intent: keep entered/defaulted values separate from the user's assertion that a repeated item was actually completed.
   - Usage: normal and prescribed set rows on the exercise page, for an active or a completed session (`components/exercise-page/set-row.tsx`).
   - Rules: use a dedicated mobile-sized checkbox-like target independent of row editing; show distinct unchecked and checked shapes so color is supplemental; confirm only valid values ([[set.performed]]); allow confirmation to be undone without clearing values; exclude unchecked items from completion metrics; require an explicit discard decision when valid unchecked work would be removed at submit/save (an untouched planned row is not work: Done drops it silently, and only `Complete exercise` names it); and keep source identity separate from confirmation status (for example, inactive planned rows use a semantic surface and accessible source wording remains available when the shared selected-row surface temporarily overrides it, while the hollow/tick control communicates performance).
6. Stream card pattern
   - Intent: scan other people's recent activity at a glance and drill into one item.
   - Usage: the group stream (`components/groups/group-stream-list.tsx`): session cards (`stream-session-card.tsx`) and competition event cards (`group-metric-stream-card.tsx`).
   - Rules: a summary `Card` link that never expands; the whole card is one accessible press target that navigates to the detail; a session card shows who, the status in text plus a glyph, never a colour ("Training now" beside the `set-current` ring, or "Completed · duration" in `ink-muted`), when/where, and `N sets · N exercises` in Plex Mono; newest first, in server order: a record card is never moved under its session card. A record card reads `<name> · record`, its figures following [[copy.no-weight-unit]] and its certification in words (`Uncertified` / `Certified by …` / `Certification ended`), with no band and no inline action: certifying happens in the record sheet it opens (pattern 11). A withdrawn GR (its set edited or deleted) leaves its place and shows once, dated at withdrawal, as the same card read `<name> · GR withdrawn` with no certification and never the private cause. Membership events (joined / left / removed) are lighter rows behind a `rule` hairline, not cards.
7. Offline marker pattern
   - Intent: keep cached server data usable offline without hiding that it may be stale.
   - Usage: every group read screen (`components/groups/offline-banner.tsx`).
   - Rules: a neutral `Notice` with the `offline` glyph above the content, announced when it appears, reads `Offline · last updated HH:MM` (local time of the cached payload); no warning hue (the glyph and the words carry it); cached data stays visible; with no cache, show an offline empty state (`StatePanel`) instead of a spinner; the marker clears on the next successful refresh.
8. Pull-to-refresh pattern
   - Intent: an explicit, familiar refresh for server-backed lists that also refresh automatically.
   - Usage: group lists and screens (`RefreshControl`).
   - Rules: only a user pull shows the spinner; automatic refreshes (focus, polling) stay silent; a failed pull surfaces through the offline marker or the inline error with `Retry`, never a blocking dialog.
9. Online-only write pattern
   - Intent: writes to shared server data either happen now or visibly do not happen — never silently queued.
   - Usage: every group write (`src/groups/use-group-action.ts`, `components/groups/write-notice.tsx`).
   - Rules: refuse before any request when offline; show the failure inline next to the action saying nothing changed, as a `danger` `Notice`; an uncertain certification transport result requires refresh/review before retry and makes no no-change claim; a confirmed success is a neutral `Notice` with the `success` glyph (e.g. "Performance certified."), never a success hue; keep the screen's data and form input as they were; no queue, no automatic retry; destructive writes confirm first (pattern 3).
10. Secondary-source search section pattern
   - Intent: let a search reach items from another source without crowding the default list.
   - Usage: the session view's exercise picker's `From your groups` section and `Groups` toggle (`components/groups/picker-group-section.tsx`).
   - Rules: the default (empty-search) list never shows the secondary source; with search text its matches follow the user's own matches under a labelled section header; a toggle in the filter row under the search box (a chip, solid `ink` while on — never the screen's `accent`) narrows the list to the secondary source only (and lists all of it when the search is empty); each row states its relationship to the user's own data in text ("linked: …" / "not linked"), not color alone; picking a row resolves to the user's own item or opens an explicit choice sheet. That choice sheet (`GroupExercisePickSheet`) is a `Sheet` with no Cancel: radio rows (`radio-on` / `radio-off` in `ink`, no ground change), unavailable choices in `ink-faint` beside their reason, and its confirm as the sheet's one `accent`, even over a screen that has its own.
11. Record set detail sheet pattern
   - Intent: one place to read and act on a shared record set, wherever it is shown.
   - Usage: stream record cards and full-board rows (`components/groups/group-metric-record-sheet.tsx`).
   - Rules: every surface showing a record set opens the same in-route `Sheet`, with no Close: the backdrop, Android back and the VoiceOver escape dismiss it (G5); the sheet shows the ranked value (Plex Mono, `record`), score units following [[copy.no-weight-unit]], permitted logged context, date and certification state in text; normalized records omit raw/absolute load and private audit context; its actions come from one pure rule over my role and my relationship to the set (`buildMetricRecordSheetModel`), never from the surface; a surface may offer the sheet's non-destructive primary action inline, sharing the same write state; writes follow pattern 9 and removals confirm (pattern 3); after a write the host re-reads, and the sheet shows the server's returned state meanwhile. `Certify` is the sheet's one primary; a removal is a `danger` row, and "View full session" a row with a chevron.
12. In-place row logger pattern
   - Intent: log the next item of a list without leaving it, one-handed, mid-set.
   - Usage: the exercise page's set list (`components/exercise-page/set-logger.tsx`).
   - Rules: the open row expands in place into its editor (labelled fields of one height, the commit control on the list's control axis); it opens on the first unfinished row by default, or on a row the user taps, one at a time; entered values are kept as typed (autosave) and stay unconfirmed until the commit control, which is the screen's one primary and is disabled until the values are valid; committing moves the editor to the next unfinished row; a row's state stays in its glyph, which the user can also toggle directly without opening the editor.

13. Read-only link card pattern
   - Intent: summarise one item of a working set (an exercise in the session) and open it, without editing in place.
   - Usage: the session view's exercise cards (`components/session-view/session-exercise-card.tsx`).
   - Rules: the whole card is one `Card` link with an accessibility label that states the summary (name, done count, record); no controls inside it; editing and removal live on the destination; set rows follow [[set.row-figures]]; a record earns a band on the card, not a badge on the row.

14. On-demand explainer pattern
   - Intent: explain a specialist chart without adding inline commentary ([[copy.no-inline-explanation]]).
   - Usage: `Information` (`components/ui/information.tsx`), used by `components/rm-curve/help.tsx` beside the chart title.
   - Rules: an accessible label names the topic; the button keeps a full mobile tap target. The existing `Sheet` holds short, plain-language sections in a scrolling body and uses its standard dismissal gestures, backdrop and accessible escape. Opening or dismissing changes no chart choice or selection.

15. Fit-to-height card pager pattern
   - Intent: show a few summaries one screen each, with nothing to scroll.
   - Usage: Today (`components/today/today-cards.tsx`), on `SwipePages`. The Groups screen swipes its four pages on the same pager, but its pages scroll and At a glance's stepper and metric head the page, outside its cards.
   - Rules: each page fills the height between its tabs and the tab bar, as its own cards (You: progress over session; a group: board over sessions) or, for a panel, one `Card`; each page's cards take the full width (no peek of the next) and paging snaps; tabs above name every page and move to it on tap, so a swipe is never the only way; each page has one elastic part that takes the height left (the chart, or the sessions list) above a fixed floor, and a list too long for its card scrolls inside it rather than clips; links are text buttons inside the cards (`Sessions`), never a chevron row; a page's own controls sit in its cards, never beside the tabs (the group's name and switch head its board card).

## Quality and closeout

Make the primary action/data obvious within three seconds, entry fast, feedback
immediate and errors local. Progressively disclose secondary controls; prefer
8pt-based spacing increments. Keep mobile controls readable and reachable, layouts usable on small
phones without horizontal scrolling, and color supplemental to words/shapes.
Use meaningful accessibility labels and explicit destructive confirmation.

Specify flows and pattern first, build the smallest slice, review appearance at
small/normal widths and exercise interactions, then refine and run the agreed
`./boga` gates. Every completed UI task links happy and failure-path assertions,
visual captures and contract traceability. Update shared patterns when needed.

Do not ship an ambiguous/incomplete primary flow, hidden validation feedback,
missing evidence, or an unrecorded new pattern. Record justified exceptions in
the PR's Deviations section.
