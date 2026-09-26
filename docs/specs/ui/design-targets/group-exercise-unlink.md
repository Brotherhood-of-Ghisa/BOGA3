# Group exercise unlink — accepted behaviour brief

## Target

The repository-native [task brief](https://github.com/Brotherhood-of-Ghisa/BOGA3/blob/11a5dd768a32c18c88758aa105a4d2c8cbcdbe11/docs/plans/tasks/T-20260923-01-Group_exercise_unlink_UX.md#ux-contract) governs the behaviour. **Appearance** is governed by [`groups.md`](groups.md), section "Group exercises and linking (DLM-T14)": the rows, the chooser `Sheet`, the notices and the Link screen in the design language. The native confirmation `Alert` is OS chrome. No external design artifact or new route.

The captures this record once held (baseline, chooser, confirmation, success and offline, on a small and a large iPhone) showed the retired styling and were deleted by DLM-T14 (T14-D4); they remain in git history before that change. The accepted captures are listed in `groups.md`.

## Brief

- Show an independent `Unlink…` action for a member's linked exercises.
- Confirm one mapping directly; choose one stable personal ID when several are linked.
- Explain leaderboard effects, preserved activity/certifications, and offline/frozen conditions.
- Keep names readable on small phones and actions independently accessible.

## Behaviour

- The chooser (`Your linked exercises`) is a `Sheet` with no Cancel: the backdrop, Android back and the VoiceOver escape dismiss it and write nothing. A choice closes it, and the confirmation opens only once it has gone (`Sheet.onDismissed`: the iOS modal's dismissal, or at once on Android), then focus returns to the launching row.
- Unlink targets are at least 44 pt, names wrap within the row, and the admin row action stays a separate accessible target from `Unlink…`.
- Ranking, sharing, certification and schema semantics are unchanged by unlinking: past activity and existing certifications are kept; eligibility changes after sync.

## Flow-to-test coverage

| Flow / failure | Evidence |
| --- | --- |
| One mapping; all three member roles; dismiss; success without navigation | `groups-exercise-screens.test.tsx` |
| Several mappings; duplicate/missing/deleted names; stable selection; dismiss/reopen; untouched mapping | `groups-exercise-screens.test.tsx`, `groups-exercise-view-model.test.ts` |
| Dismiss-then-confirm sequencing (iOS `Modal.onDismiss`, Android at once) | `ui-design-primitives.test.tsx` (`Sheet` `onDismissed`), `groups-exercise-screens.test.tsx` |
| Shared wording; archived, inactive and combined frozen conditions | `groups-link-view-model.test.ts`, both exercise screen suites |
| Read loading/failure and retry; write retry; pending duplicate callbacks; stale target; committed write followed by failed read | Both exercise screen suites, `exercise-group-links-repository.test.ts` |
| Offline local unlink and reconnect notice | Both exercise screen suites |
| Cancel → unlink → sync → both boards exclude set → same completed record/certification → relink restores eligibility; second mapping retained | `groups-two-user-stream.yaml` §7d (`groups-unlink-01` … `-07`) and `groups-counterparty.js` authenticated assertions |
| Existing ranking/certification semantics | `groups-leaderboards` lane: R5 in `groups-boards.sh` and unlink/relink in `groups-certification.sh` |
