# M28-T01 — Define the simplified bodyweight contract

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M28-simplify-bodyweight-ux-and-semantics.md`
- Areas: docs, frontend, backend, cross-stack; UI impact: yes

## Objective

Replace the M27 bodyweight product, data, group, coaching and UI contracts with
the agreed M28 direction before implementation begins. Produce one internally
consistent source-of-truth set and a repo-native accepted design target that
the integrated implementation can follow without reopening settled product
decisions.

## Scope

- In:
  - graduate milestone decisions D1-D17 into their owning durable specs;
  - specify the clean kg-only data/wire model and coordinated cutover;
  - specify private versus group settings, calculation policies and privacy;
  - replace the accepted bodyweight UI target and rendered-state checklist;
  - update testing/rollout documentation wherever the retired contract is
    currently asserted.
- Out:
  - production code, migrations, fixtures or tests;
  - speculative UI implementation beside the accepted target;
  - reopening the agreed formulas, defaults, vocabulary or toggle model without
    a newly discovered material conflict reported to the user.

## Decided

- Implement every milestone decision D1-D17.
- Ordinary personal logging is the default contract; bodyweight-aware behavior
  is enabled separately for a private user or a group.
- Contributions survive every preference toggle; workout history and readings
  survive migration; obsolete compatibility fields do not.
- The UI is kg-only, uses Weight / 1RM / Volume, hides the calculation
  breakdown, and never prompts for bodyweight during a workout.
- Personal missing bodyweight falls back to zero; strict group scoring omits
  the dependent score.
- Group use of a private reading must not disclose it. Certification
  fingerprinting is provisional and must be described honestly as calculation
  consistency, never weight verification.

## Open — resolve with the user at session start

None. If current source-of-truth specs reveal a material contradiction that
cannot implement D1-D17 together, report the exact conflicting sources and
impact before choosing a replacement rule.

## Deliverables and acceptance

1. Product and architecture decisions state the new ordinary-first contract.
2. The data model and Sync v2 contract define the private preference, group
   preference, renamed contributions, kg-only fields/conversion and removed
   legacy fields without sacrificing workout history or readings.
3. The bodyweight contract specifies ordinary, personal-aware and strict group
   calculation policies, including numeric zero behavior and the exact 1RM
   projection formula.
4. The groups contract specifies independent group control, explicit-link
   semantics, missing-reading exclusion, private-reading non-disclosure and the
   tentative certification fingerprint.
5. Coaching/agent and import contracts align with the private preference and
   kg-only model.
6. UI rules and the accepted target show the Settings row, conditional
   contribution field, ordinary logger vocabulary, absence of session prompts,
   group-admin controls and all required missing/zero states.
7. Every durable M27 statement that conflicts with the new direction is
   replaced rather than left as an ambiguous parallel rule.
8. `./boga test for --diff origin/main...HEAD` is recorded and every selected
   docs lane is green before the task PR opens.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Enable private calculations | Settings → enable `Bodyweight calculations` | Same-row `Manage weights` appears; saved contributions become visible in exercise editors | Toggle remains usable offline; disabling hides controls without deleting values |
| Manage readings | Enabled Settings row → `Manage weights` → add/edit/delete kg reading | Dated history updates and affected projections are eligible to refresh | Invalid entry remains editable; no workout/session prompt exists |
| Configure personal exercise | Enable private mode → edit exercise → set contribution | One 0-100% field controls personal bodyweight math | Zero retains ordinary math; disabling mode hides and preserves the value |
| Log ordinary set | Private mode off or contribution 0 → log Weight/reps | Weight, 1RM and Volume use entered kg only | Blank Weight becomes zero; metrics show numeric zero, not unavailable |
| Log bodyweight-aware set | Private mode on, contribution positive → log Weight/reps | Applicable dated reading participates silently in Volume/1RM | Missing reading falls back to zero privately without warning or blocking |
| Enable group calculations | Group admin → enable setting → edit group contribution | Group rules publish under the group's own setting and contribution | Disabling hides and preserves values; missing member reading yields no dependent score |

## Accepted design target

Use a repo-native brief plus the existing Settings, exercise editor, logger,
history/Stats and group administration recipes. Update
`docs/specs/ui/design-targets/bodyweight.md` so this textual contract and its
selected current reference captures govern implementation. The target must
explicitly supersede M27's session bodyweight card, required movement/loading
fields, unit selectors and `Added` vocabulary. No external design service is
required.

## Specs to update

- `docs/specs/00-product.md` — ordinary-first product behavior and independent
  private/group opt-in.
- `docs/specs/03-technical-architecture.md` — replace the high-level M27
  bodyweight decision and consumer boundary.
- `docs/specs/05-data-model.md` — settings, contributions, kg conversion,
  retained history/readings and removed fields.
- `docs/specs/10-api-authn-authz-guidelines.md` — private reading use by groups
  and connected coaches without unintended disclosure.
- `docs/specs/tech/bodyweight-load-contract.md` — own D1-D16 calculations,
  storage, refresh and rollout semantics.
- `docs/specs/tech/sync-v2-server-contract.md` — clean wire fields, capability
  cutover and synced private preference.
- `docs/specs/tech/groups-contract.md` — group preference/contribution,
  evaluator behavior, privacy and certification.
- `docs/specs/ui/design-targets/bodyweight.md` — accepted replacement target.
- `docs/specs/ui/ux-rules.md` — Settings, editor, logger and analytics semantics.
- `docs/specs/ui/design-language.md` — Weight / 1RM / Volume vocabulary.
- `docs/specs/ui/screen-map.md` — changed Settings/bodyweight and overlay states.
- `docs/specs/ui/components-catalog.md` — changed settings, editor and logger
  component roles.
- `docs/specs/06-testing-strategy.md` and
  `apps/mobile/app/__tests__/README.md` — only where coverage policies must
  replace retired M27 expectations.
- `apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md` and
  `supabase/functions/agent-api/README.md` — kg-only import/coaching contracts.

## Gates

Expected from `./boga test for` (the command is authoritative):

- `./boga test docs-check`

Do not run implementation or simulator gates for this docs-only contract task
unless `./boga test for --diff origin/main...HEAD` selects them.
