# M40 — Coded UI patterns with human acceptance

- Status: `in_progress`
- Created: 2026-11-02
- Planning baseline: `8f540b3dacd22ca3f934fecda4020e9ffe74d2e5` on `origin/main`
- Process: task protocol; one task, session, worktree and PR per card.

## Objective

Turn Boga's existing visual language into four reusable production patterns,
adopt them in representative screens, and prevent features from assembling a
different style from otherwise valid tokens. Humans must inspect and accept
the coded result of each migration before it ships. CoW's corrected appearance
is the regression example: approved text roles alone did not ensure that the
heading, date and content formed the right composition.

## Scope

- In: pattern contracts; shared compact header/row recipes; four production
  compositions; a development-only gallery rendering those same components;
  reference migrations; Jest and executable guardrails; pattern selection and
  human visual acceptance in the UI workflow.
- Out: a new visual identity, fonts or token scales; a new component framework
  or Storybook dependency by default; backend, sync or calculation changes;
  a whole-app restyle; copying the HTML sketches into a parallel production UI.
- Product facts: no calculation, eligibility, formatting or copy decisions are
  intended. Each task still runs product review; any discovered fact change
  must be highlighted and handled under the existing fact-authoring procedure.

## Agreed design direction

### D1. Four pattern families, composed from current foundations

Names are working API names; task-level design may improve them without
changing their roles.

| Pattern | Structure | Production reference |
| --- | --- | --- |
| CompactCard | Header with label/metadata, subject, short facts, optional approved detail | Group Stream; corrected current/past CoW summaries |
| ListCard | Header, optional column labels, repeated rows, optional footer action | Group leaderboard cards; Today weekly board |
| SortableTable | Sortable column headers, optional group labels, data rows and optional contribution disclosure | Progress by Muscle and an individual muscle's contributing exercises |
| SummaryTile | Header, headline metric group, comparisons and optional approved supporting section | At a glance's Group stats tile |

Reuse Card, ListRow, Stat, text roles and the existing StatsTable/comparison
primitives. Shared foundation code stays in the UI layer; domain readers,
ranking, sorting arithmetic, formatting and navigation stay with their current
owners. Public pattern APIs accept content and behavior, with bounded semantic
variants. They do not expose arbitrary typography or density overrides.

### D2. Compact is the default in every family

Use the current token scales. SummaryTile earns prominence through headline
figures and grouped information while retaining compact spacing. ListCard and
SortableTable share a row-spacing contract for the same density, covering
line-height, vertical insets, alignment, separators and wrapping. Nested table
rows inherit that rhythm; indentation or semantic emphasis can distinguish them.

Do not stack minimum heights and padding accidentally, shrink data to fit, or
trade away touch targets. A whole-card interaction does not automatically make
each passive row a separate 44pt target. Settle any passive/interactive row
variants, exact spacing and long-content behavior in T01 using native renders;
the sketches' CSS values are not an accepted production contract.

### D3. Select before building; derive explicitly

For new UI blocks, show the applicable catalog patterns, recommend one and ask
the human to choose before implementation. When none fits, show the nearest
parent and the proposed differences, keeping inherited typography and geometry
explicit. Get that derivation accepted before coding. Record the selected
pattern/variant in the task's UX Contract and PR. Keep one source of truth for
each rule; a skill may route the workflow but must not duplicate the rules.

### D4. The gallery uses production React Native components

Build a small development-only gallery, using the existing harness if suitable.
It renders the same exports and fixtures that the migrated screens use; no
hand-maintained HTML copies. Include representative and edge states for every
family. Keep preview-only fixtures and routes out of ordinary navigation and
release behavior. Do not add a dependency solely to host the gallery without
first showing why the existing harness cannot do it.

### D5. Human acceptance is a migration gate

Each implementation PR must provide the running coded component and its migrated
reference screen for human inspection. Show current before/after captures at
small and normal phone widths, plus long names/figures, multiline or stacked
layouts, relevant empty/loading/error states, and the actions the pattern owns.
Show list and table rows together when reviewing their shared spacing.

The human must explicitly accept the result, or request changes. Record who
accepted, the exact reviewed commit, device/viewport and accepted surfaces in
the PR. Tests, AI review, screenshot capture, silence, or acceptance of this
plan/sketch cannot substitute. A material UI change after acceptance requires
fresh captures and renewed human acceptance. Until accepted, report the PR as
awaiting visual acceptance and do not merge it, declare that migration complete,
or expand it to additional screens. Normal task-card closeout becomes effective
only when the accepted PR merges; downstream tasks start from merged work.

### D6. Automate measurable rules; review semantic choices

Use the existing ui-guardrails lane and ESLint/Jest infrastructure. Tests should
prove role/casing, metadata alignment, shared row geometry, responsive content
and preserved actions, including a regression that rejects the old CoW role
choice. Guardrails should reject unauthorized typography assembly/overrides in
adopted surfaces and cover both TS style modules and TSX components. Demonstrate
failing and safe examples. Semantic pattern choice remains part of review.

Define the initial enforcement scope and expansion policy explicitly; a rule
must not silently exempt every consumer or claim to cover untouched screens.
No new suppression, weakened threshold or raised budget without the operator's
agreement. Follow-on work adopts the accepted patterns as screens are touched.

## Design inputs and freshness

On 2026-11-02 the operator approved all four native iPhone Pro Max after
previews as templates. For the selected families, compact row recipe, exact
references and remaining review scope, load `docs/plans/M40-pattern-contracts.md`
before implementing a card. This approved native brief supersedes the earlier
conceptual HTML sketches. The baseline includes the CoW typography correction
and revised At a glance composition. Template selection is settled; each later
coded migration still requires the acceptance in D5. Evidence stays in the PR.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M40-T01-Agree_pattern_contracts | Agree the four contracts, compact row recipe, reference states and human acceptance workflow | none | completed |
| M40-T02-Compact_card_and_gallery | Implement CompactCard, start the native gallery, migrate Stream and CoW references | T01 | completed — effective when this PR merges |
| M40-T03-List_card_and_shared_rows | Implement ListCard and shared compact rows; migrate leaderboard references | T02 | planned |
| M40-T04-Sortable_table_migration | Extend StatsTable with the shared rows; migrate Muscle/contributor tables | T03 | planned |
| M40-T05-Summary_tile_migration | Implement SummaryTile; migrate At a glance's headline tile | T02 | in_progress — awaiting coded acceptance |
| M40-T06-Enforce_pattern_adoption | Complete guardrails, catalog routing and the accepted four-pattern gallery | T04, T05 | planned |

T03 and T05 may run in separate worktrees after T02 is accepted and merged;
coordinate shared exports and catalog edits. T04 follows the accepted row recipe
from T03. Each task rechecks current main and its sibling changes before coding.

## Completion

All four families have a real migrated consumer and explicit human acceptance;
the gallery renders those production components; list/table row rhythm matches
for the same density; guardrails catch demonstrated drift; and the choice or
derivation workflow is in the owning UI docs and agent entrypoint. Delete each
task card in its shipping PR and this milestone with the final card. Durable
rules graduate into their owning specs; captures and acceptance evidence stay
in the PRs.
