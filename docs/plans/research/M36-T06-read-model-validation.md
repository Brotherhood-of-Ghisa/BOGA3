# Descriptive RM read model — validation

Status: completed; code/product review clean and the owner confirmed “Keep the agreed set” on 2026-10-14. Built from approved T05 commit `38334154604be3eef2fff1aed3dfa0144d8dcf82` on the experimental branch stack. No chart/page/navigation or inferential runtime.

## Scope and evidence

The data adapter reads current metadata/policy, completed nondeleted raw sets and applicable reading context in one bounded SQLite transaction. The model retains set/session/block identity, raw effort, actual metrics and analytical projection. Projection/inversion reuse the adopted kernel; reference and observations share exercise/gym/effort scope. Unknown nonnull performance statuses remain unperformed; targets are not observations. The headless hook masks superseded account/filter reads, observes existing write/catalog/bodyweight signals, retains same-scope data on failed refresh and offers retry.

Three new suites add 30 tests: all 24 prefixes in plateau/stable/gradual histories through pure transforms and migrated SQLite, repeated blocks/session-best support, independent cutoff and sparse/effort/gym cases, ordinary/per-side/bodyweight/zero/single/high-RIR/overflow contexts, the 11 established load vectors and controlled refresh/race failures. Frozen inputs/oracle are reused; no research regression runs or new programme fixture.

The saved authorized snapshot (SHA256 `81c8f8c77891dda1e3a7138841f6ae951c320238ab6d9ce014fa7a0e2bf67b00`) was replayed through the production loader/model in migrated SQLite, replacing only native database open. The 181-row snapshot was replayed; all six exercise/gym cohorts' evaluated qualifying sets, projections and reference support reconcile with the earlier oracle; evaluated set counts are 4/1/3/14/5/1, prior support 3/0/1/9/2/0. One cohort has a reference; five retain observations without one. Exported metadata has zero bodyweight contribution for these exercises; broader loading contexts use the shared vectors and SQLite cases. No fresh remote query or private rows/IDs are committed. Replay uses the previously declared personal effort defaults because device-local choices are unavailable remotely. Imported effort provenance remains unverified; descriptive parity supplies no strength/break assertion.

## Local checks

| Check | Result |
| --- | --- |
| fast | PASS: 282 suites / 3,889 tests plus aggregate checks |
| jest-coverage | PASS: 86.53% branches / 94.41% lines |
| complexity | PASS |
| dependencies | PASS: 518 modules / 2,595 dependencies; 13 existing known violations unchanged |
| docs-check | PASS; all persistent docs/facts within existing budgets |
| private snapshot replay | PASS: six cohorts; native open only replaced |
| independent source/product review | Clean; two numerical findings resolved |

Review fixes preserve finite kg residuals when only percentages overflow, and positive medians at the smallest representable load. No threshold, formula, global metric or loading rule changed. The whole-suite Expo logger-after-teardown warning also occurs in the unchanged parent; no clean handle/device result is claimed.

Raw logs, replay output and independent report remain in ignored `apps/mobile/artifacts/research/rm-curve-data/`. The path checker suggests backend/groups lanes because of directory breadth; the owner agreed the fast/quality/docs set for this read-only feature. Default backend and groups-leaderboards lanes were omitted as covered-by-jest: no server/schema/sync or group-consumed calculation changed, and the new kernel module is absent from those consumers' import graphs. No UI/device lane applies to this unexposed read model. Production UI acceptance remains later work.
