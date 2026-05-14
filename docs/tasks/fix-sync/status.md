# Sync redesign — status

Last updated: 2026-05-14

## Tasks

| Task | Wave | Status | Builder | PR | Reviewer verdict | Merged | Notes |
|---|---|---|---|---|---|---|---|
| T1 — Backend schema + projection rewrite | 1 | **MERGED** | — | [#7](https://github.com/dinoderek/BOGA3/pull/7) | approved | ✅ | partial-unique active indexes rebuilt with `owner_user_id` leading |
| T2 — Drop originScopeId / originSourceId | 1 | **MERGED** | — | [#10](https://github.com/dinoderek/BOGA3/pull/10) | approved (rebased) | ✅ | rebased to `m0011`; fixed T3's missing `_journal.json` entry as side-effect |
| T3 — Sync runtime hardening | 1 | **MERGED** | — | [#9](https://github.com/dinoderek/BOGA3/pull/9) | approved | ✅ | all 4 bugs addressed; new migration `0010_sync_runtime_attempt.sql` |
| T4 — Seed survival after bootstrap wipe | 1 | **MERGED** | — | [#8](https://github.com/dinoderek/BOGA3/pull/8) | approved | ✅ | option 2 (seeder outside merge tx) |
| T5 — Backend test updates | 2 | **MERGED** | — | [#12](https://github.com/dinoderek/BOGA3/pull/12) | approved + slow backend gate verified green | ✅ | new test runs as part of `quality-slow.sh backend` |
| T6 — Documentation updates | 2 | approved | — | [#13](https://github.com/dinoderek/BOGA3/pull/13) | approved | awaiting human | T2 overlap resolved cleanly |
| T8 — Seed once; never overwrite; dev reset | 2 (added) | dispatched | builder running | — | — | — | branch: `fix-sync/t8-seed-once` |
| T7 — Drop hosted DB + runbook | 3 | blocked on T5+T6 | — | — | — | — | also: regenerate `supabase/hosted-bootstrap-sync.sql` (stale per T1 reviewer) |

## Status legend

- **pending** — not yet dispatched
- **dispatched** — builder agent running
- **pr_open** — builder opened PR; awaiting review
- **changes_requested** — reviewer flagged issues; builder revising
- **approved** — reviewer approved; awaiting human merge
- **merged** — done

## Follow-ups

See [follow-ups.md](follow-ups.md) for items uncovered during the redesign that are out of
scope for the current task set. Top of list: P1 — when/how to make quality gates
mandatory in CI.

## Deviation log

- **PR #6 (plan/contract docs)** merged. No code deviations; doc artifact only. No ripple
  to in-flight builders.

(Coordinator updates after each merge with the deviations the builder reported.)
