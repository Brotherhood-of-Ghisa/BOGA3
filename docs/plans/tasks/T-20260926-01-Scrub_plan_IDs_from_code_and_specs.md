# T-20260926-01 — Scrub plan IDs from code and specs

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: cross-stack (comments, tests, Maestro flows, specs); UI impact: no

## Objective

Plans are ephemeral and never referenced (AGENTS.md "Planning"). The path half
is enforced by `docs-check`; task/milestone IDs are not. On 2026-09-26 about
550 ID references (`M22-T04`, `M25-T07`, `T-20260923-02`, `DLM-T14`, …) sat in
~60 files outside `docs/plans/**` and `docs/brainstorms/**`. Remove them without
losing meaning.

## Scope

- In: specs (`docs/specs/tech/groups-contract.md` ~140, `ui/components-catalog.md`
  ~96, `ui/screen-map.md`, `ui/navigation-contract.md`, `ui/ux-rules.md`,
  design targets, 05/06/08), code comments in `apps/mobile/**`, Jest test
  names/comments, Maestro flows and scripts, `supabase/tests/**`,
  `supabase/README.md`.
- Out: migration filenames (`supabase/migrations/*_m22_*`, `*_m25_*`) — applied
  migrations are not renamed. Git history, commit messages, PR bodies.

Inventory: `git grep -nE '\b(M[0-9]{1,2}-T[0-9]{2}|T-20[0-9]{6}-[0-9]{2}|DLM-T[0-9]+)\b' -- ':!docs/plans' ':!docs/brainstorms'`

## Decided

- Replace an ID with what it stood for (the rule, feature, or section it
  names), or delete it when it only recorded provenance.
- Spec decision tables keyed by IDs (e.g. groups-contract "E0.4 … §6.3 M25-T08")
  keep their own stable keys (P#, D#, E#); drop the task column/suffix.

## Open — resolve with the user at session start

1. Add an ID guard to `docs-check` (fails on the regex above outside the
   working-notes trees, migration filenames exempt)? Pro: rule stays true.
   Con: false positives on legitimate strings that match the pattern.
2. Split into two PRs (specs; code/tests/flows) to keep review size sane?

## Deliverables and acceptance

1. The inventory command returns only migration filenames (and their
   `supabase/README.md` listing, if any), or nothing.
2. No behaviour change: identical test counts before/after.

## Specs to update

- The specs listed in scope (text only).

## Gates

Expected from `./boga test for`: `fast`, `backend` (supabase/tests),
`frontend` + `ios-groups-e2e` (Maestro flow edits).
