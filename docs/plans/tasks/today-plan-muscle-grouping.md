# Today Plan: grouped Recovery with set totals

Status: ready for implementation; design approved by the user in chat.
Scope of this PR: task and mock evidence only. No runtime or product-fact changes.

## Goal and design target

When muscle grouping is enabled in Settings, Today's Plan Recovery must inherit
that grouping. Use the existing account configuration and group membership;
do not hard-code the mock's illustrative Back/Arms/Core/Legs taxonomy.

The approved target is option 1 (grouped sections), refined to show a plain
set total beside each expansion chevron. Mock evidence is embedded in the PR.
It is generated design evidence, not a screenshot of the running app.

## UX contract / acceptance criteria

- [ ] Grouping enabled: render related child muscles under lightly tinted group
  headers, using existing theme tokens. Grouping disabled: retain the flat view.
  Preference changes and account switches update the view without a local toggle.
- [ ] Each header is one full-width pressable: group name left, trailing
  `12 sets` plus chevron right. Give the number stronger emphasis than the unit.
  No fraction, aggregate target, extra badge, or separately tappable arrow.
- [ ] Header count is the total across the group's eligible child muscles for
  the same calendar week as the child Target column. Sum underlying numeric
  contributions before applying the canonical display formatter.
  It is attributed muscle work, not a unique physical-session count.
- [ ] Keep the total visible both collapsed and expanded. Use right chevron when
  collapsed, down when expanded. Tapping anywhere in the header toggles only
  that group; initially expand groups to preserve the overview.
- [ ] Expanded child rows retain their four daily values and individual weekly
  target fractions, with existing progress navigation. Header presses must not
  trigger child navigation. Align totals and fractions with a consistent
  trailing chevron gutter, including long names and large text.
- [ ] Exclude untracked entries and honor existing effort/secondary preferences;
  use [[set.performed]], [[set.eligibility]], [[muscle.secondary-filter]],
  [[muscle.untracked]] and canonical formatting from [[muscle.set-count]].
  Preserve existing date windows ([[comparison.allowed-periods]],
  [[comparison.window]]) and child targets ([[muscle.weekly-targets]]).
- [ ] One accessible button per header, with group name, total and expanded
  state; hide collapsed descendants from accessibility. Meet existing touch
  target and theme requirements. Known zero reads `0 sets`; singular `1 set`.
- [ ] Keep the weekly Plan card and navigation unchanged. Preserve existing
  loading, empty and error behavior.
- [ ] Remove the mock's descriptive `Grouped by muscle` subtitle for
  [[copy.no-subtitles]]. Daily cells retain actual numeric values and
  [[copy.blank-history]] behavior; mock colored cells are illustrative.

## Contract reconciliation required in the implementation PR

The approved interaction intentionally requests child expansion. Current
[[muscle.no-breakdown]] hides anatomy entries within a merged reported muscle;
[[muscle.report-groups]] defines Detailed/Broad/Custom merging, which must not
be confused with anatomy families. Establish which configured grouping is
being expanded and explicitly update the affected product facts when shipping.
Do not silently substitute family sections for the saved muscle grouping.

The requested total is a sum across child muscles. [[muscle.set-count]]
currently deduplicates family buckets and merged reported muscles at strongest
role. For overlapping children, the requested sum can differ from that
deduplicated figure. The implementation must record the agreed distinction
in the owning fact, retain existing physical-set analytics, and cover overlap
and secondary half-credit. Do not infer a counting rule from mock integers.
This planning-only PR does not change an accepted fact or running behavior.

## Implementation entry points and verification

Start at `apps/mobile/components/today/plan-cards.tsx`,
`apps/mobile/components/today/use-today-plan.ts` and
`apps/mobile/src/today-plan/`. Reuse account muscle-report setup and existing
UI primitives; load the components catalog and UX delivery standard before
choosing the custom accordion's production parents.

Add meaningful Jest coverage for preference on/off and changes, membership,
sum-before-formatting, overlap, untracked entries, secondary credit, zero,
expand/collapse and child navigation. Update the owning product facts in the
implementation PR and run separate product review.

Agree implementation lanes from the UI defaults: fast plus platform UI lanes,
and the three quality targets required by AGENTS.md. Capture native expanded,
collapsed, long-name, large-text and empty states; compare against the approved
target and explain deviations. Do not claim the generated mock is native QA.

Delete this task and its in-repo target evidence when implementation ships;
retain the PR and git history as evidence.

AI assistance: Codex (GPT-6), including generated mock design.
