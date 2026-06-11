<!--
Keep this lean: data and file:line pointers, not prose. ~25 lines.
Link CI runs / artifacts / prior threads — do not paste them.
-->

## Objective

<!-- 1-2 sentences: what changes and why. No history/background. -->

## Tests

<!-- List EVERY gate lane (docs/specs/02-quality-and-test-gates.md). Mark ✅ ran / ⛔ N/A.
     Add an evidence link for greens and a one-line reason for each ⛔. "CI green" alone is not enough. -->

| Gate | Ran? | Result |
| --- | --- | --- |
| fast — `./boga test fast` (lint/typecheck/jest + backend smoke) | ⬜ | |
| slow frontend — `./boga test frontend` (Maestro smoke/data-smoke/auth-profile/sync-e2e) | ⬜ | |
| slow backend — `./boga test backend` (auth/RLS + sync-v2 + sync-infra) | ⬜ | |
| iOS sync e2e — `./boga test ios-sync-e2e` (UI↔server; mandatory for sync/scheduler/auth-session changes) | ⬜ | |

## Review hard

<!-- 2-4 spots that need real scrutiny, each with file:line. "Nothing risky — mechanical" is a valid answer. -->

-

## Deviations from brief

<!-- What differs from the ask, and why. Write "None." — never leave blank. -->

- None.
