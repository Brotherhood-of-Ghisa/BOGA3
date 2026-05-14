# Sync redesign — status

Last updated: 2026-05-14

## Tasks

| Task | Wave | Status | Builder | PR | Reviewer verdict | Merged | Notes |
|---|---|---|---|---|---|---|---|
| T1 — Backend schema + projection rewrite | 1 | approved | builder done | [#7](https://github.com/dinoderek/BOGA3/pull/7) | **APPROVED** | awaiting human | dev: partial-unique active indexes rebuilt with `owner_user_id` leading; reviewer flagged `supabase/hosted-bootstrap-sync.sql` is now stale → added to T7 checklist |
| T2 — Drop originScopeId / originSourceId | 1 | approved | builder done | [#10](https://github.com/dinoderek/BOGA3/pull/10) | **APPROVED** | awaiting human | **collision with T3 on `m0010` migration entry** — second to merge must rebase to `m0011` |
| T3 — Sync runtime hardening | 1 | approved | builder done | [#9](https://github.com/dinoderek/BOGA3/pull/9) | **APPROVED** | awaiting human | all 4 bugs addressed; new migration `0010_sync_runtime_attempt.sql`; 220 tests pass; **m0010 collision with T2** |
| T4 — Seed survival after bootstrap wipe | 1 | approved | builder done | [#8](https://github.com/dinoderek/BOGA3/pull/8) | **APPROVED** | awaiting human | option 2 (seeder outside merge tx). 213 tests pass. |
| T5 — Backend test updates | 2 | blocked on T1 | — | — | — | — | — |
| T6 — Documentation updates | 2 | blocked on T1+T3 | — | — | — | — | — |
| T8 — Seed once; never overwrite; dev reset | 2 (added) | blocked on T3+T4 | — | — | — | — | added per coordinator/human discussion; touches seeder + sync_runtime_state schema |
| T7 — Drop hosted DB + runbook | 3 | blocked on T1+T5+T6 | — | — | — | — | also: regenerate `supabase/hosted-bootstrap-sync.sql` (stale PK defs + "different owner" branches per T1 reviewer) |

## Status legend

- **pending** — not yet dispatched
- **dispatched** — builder agent running
- **pr_open** — builder opened PR; awaiting review
- **changes_requested** — reviewer flagged issues; builder revising
- **approved** — reviewer approved; awaiting human merge
- **merged** — done

## Deviation log

- **PR #6 (plan/contract docs)** merged. No code deviations; doc artifact only. No ripple
  to in-flight builders.

(Coordinator updates after each merge with the deviations the builder reported.)
