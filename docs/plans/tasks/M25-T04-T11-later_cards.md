# M25 — later cards (T04–T11), lean

Each section below becomes its own card (`docs/plans/tasks/M25-T0N-*.md`)
when it is ready, refreshed against what T01–T03 actually built. Milestone:
`docs/plans/milestones/M25-group-exercises-and-leaderboards.md`.

## M25-T05 — Boards and events (backend; deps T04)

- Design §4–§5 (T6–T8). `group_board_entries`; per-(group, member, group
  exercise) recompute + diff under an advisory lock; events `record`,
  `record_voided`, `link`, `unlink`, `lead_change{reason}`; provisional rule
  for active sessions; archived boards frozen; read RPCs: podium page, full
  board (paged), history (paged); stream returns the new kinds.
- AC: every row of the §5 change table, as contract tests.

## M25-T06 — Certification (backend; deps T05)

- Design §6. `group_certifications`; certify / withdraw / cancel RPCs;
  record-set check; voiding on fingerprint mismatch; Certified boards and
  `lead_change{certification}`.
- AC: self-certify, non-record set, non-member, withdraw, admin cancel,
  re-certify after cancel, void on edit and on delete.

## M25-T07 — Mobile linking (frontend; deps T01, T03)

- Product E0.1–E0.3, D9, D13; design §7. Picker search "From your groups"
  section + Groups toggle; pick sheet with suggestion; Link screen from the
  catalogue ⋮ and recorder ••• menus; weight-entry conversion note.
- UI docs: screen-map, navigation-contract (Link screen), components catalog.

## M25-T08 — Mobile group page (frontend; deps T01, T02)

- Product P5, E0.4, D10, D14. Segments Stream · Exercises · Leaderboards
  (Leaderboards empty-state until T09); members behind the header member
  count; Exercises page with link status and admin add / copy standard /
  rename / archive using the shared `ExerciseCore` form.

## M25-T09 — Mobile leaderboards (frontend; deps T05, T08)

- Product P6–P9, E1.1–E1.3, D11, D12. Podium cards (Certified · e1RM, "You:
  Nth"), full board with both toggles, history list with reasons.

## M25-T10 — Mobile stream items and certify (frontend; deps T06, T09)

- Product P10–P17, E2, E3, D15, D16. Record / record-removed / link items,
  voided card state, session-card "N records" highlight, row detail sheet
  shared with boards, certify / remove / admin cancel actions (online only).

## M25-T11 — E2E and closeout (cross-stack; deps T07, T10)

- Extend `ios-groups-e2e`: counterparty links and pushes a record; device
  sees the record card, certifies, Certified board updates (hermetic fixture
  users per spec 11).
- Graduate decisions into `groups-contract.md`, sync contract, `03`, `05`,
  `10`, `02`/`06`, `ui/*`; delete the milestone, both plan docs, and this file.
