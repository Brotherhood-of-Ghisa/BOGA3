# M25 — Group exercises, leaderboards, certification

- Status: `planned`
- Product spec: `docs/plans/group-exercises-and-leaderboards.md` (P#, D#, E#)
- Technical design: `docs/plans/group-exercises-tech-design.md` (§#, T#)
- Builds on: `docs/specs/tech/groups-contract.md` (step 1, M22 as-built)
- Ephemeral: every card is deleted by the PR that ships it; M25-T11 graduates
  the durable decisions into `docs/specs/**` and deletes this file and both
  plan docs.

## Objective

Groups get their own exercises, members link their exercises to them, and
each group exercise has four leaderboards (Weight / e1RM × Certified / All)
with history. Records, voids, and link changes appear in a persistent group
stream, and members certify each other's record sets.

## Task graph

| Card | Title | Area | Depends on |
| --- | --- | --- | --- |
| `M25-T01` | Group exercises (server) | backend | — |
| `M25-T02` | Persistent group stream (server) | backend | — |
| `M25-T03` | Exercise-group links as a Sync v2 entity | cross-stack (sync) | — |
| `M25-T04` | Evaluator pipeline: queue, `group-eval`, set facts, lane | backend | T01, T02, T03 |
| `M25-T05` | Boards, record/void/link events, board + history reads | backend | T04 |
| `M25-T06` | Certification (server) | backend | T05 |
| `M25-T07` | Mobile linking: picker search, pick sheet, Link screen | frontend | T01, T03 |
| `M25-T08` | Mobile group page: Stream · Exercises · Leaderboards, Exercises page | frontend | T01, T02 |
| `M25-T09` | Mobile leaderboards: podium page, full board, history | frontend | T05, T08 |
| `M25-T10` | Mobile stream record items, row detail, certify | frontend | T06, T09 |
| `M25-T11` | Two-user e2e extension and milestone closeout | cross-stack | T07, T10 |

```
T01 ─┬──────────────┬─▶ T07 ─────────────────────────┐
T03 ─┤              │                                 │
T02 ─┼─▶ T04 ─▶ T05 ┼─▶ T06 ─────────────┐            ├─▶ T11
     └──────────────┴─▶ T08 ─▶ T09 ◀─(T05)└─▶ T10 ◀───┘
```

A card is **ready** when every card it depends on is merged.

Parallel-merge note: T01 and T02 both add `supabase/migrations/*group*` files
and extend `supabase/tests/groups-contract.sh`. Whichever merges second
rebases and resolves; keep migration timestamps distinct.

## Execution protocol

1. **Launch.** The coordinator offers each ready card as a spawned task (one
   session per card, its own worktree via `./boga worktree create <branch>`).
2. **Build.** The builder reads `AGENTS.md`, its card, and the design sections
   it cites; implements; runs every lane `./boga test for` requires to green
   (foreground commands, never restart Docker). It deletes its card in the same
   PR and updates this graph's status column if it adds one.
3. **Review agent.** Before opening the PR, the builder spawns a reviewer
   subagent that checks the diff against the card's acceptance criteria and
   the design, and verifies gate evidence (it does not re-run the suites).
   The builder fixes or records each finding.
4. **PR.** Body per `.github/pull_request_template.md`, validated with
   `./boga pr check --body <file>`: every gate lane ✅/⛔ with evidence,
   **Review hard** with `file:line`, **Deviations**. Then `./boga db down` and
   `./boga pr wait` in the background.
5. **Human review.** The user reviews. No merge without the user's explicit
   approval of that PR.
6. **After approval.** The builder merges, runs `./boga worktree release`, and
   offers spawned tasks for every card that just became ready.

## Out of scope

Group gyms / gym filters, time-windowed boards, bodyweight or reps-only
metrics, member exercise proposals, disputes, push notifications (P19).
