# T-20261030-02-Group_time_zone — Group time zone on the main page

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend, docs; UI impact: yes

## Objective

Move the Set time zone entry point from the CoW flow to the group main page,
showing the current saved group IANA zone above the control. Reuse the existing
focused group editor, calendar reader and write behavior.

## Scope

- In: group main page, CoW setup navigation removal, focused editor return,
  Jest coverage, app screenshots, owning product facts and navigation contract.
- Out: backend/API/schema changes, persistence, dependencies, a new picker,
  changed scoring or published CoW boundaries.

## Decided

- Every current member sees the current group calendar zone; only owners and
  admins see Set time zone. Invite remains the primary accent action.
- Show Not set only after a successful read confirms an unset calendar.
  Loading, offline and failed reads retain appropriate existing states/retry.
- Navigate to the existing group Edit screen with `focusTimeZone=1`; refresh
  the main page's saved value on return, including a subsequent zone change.
- Remove zone setup controls from every CoW flow/menu, including the scheduling
  form's Set group time zone action. An unset zone still blocks scheduling.
- Retain inline errors/retry, online-only writes, validation, revision conflict
  handling, entered text, lost-access behavior and role checks.
- Published CoWs retain their original zone and immutable time boundaries;
  the main page reads the current group calendar, never a historic CoW zone.
- **Product facts:** extend `groups.cow-calendar` in `docs/product/groups.md`
  with the cross-surface placement/visibility decision. Keep precise layout
  in component comments/tests; cite the fact from durable contracts.

## Open — resolve with the user at session start

None. The human approved this scope and the repo-native design target below.
Routine implementation and lane choices follow repository policy and reviewer
agreement; report material drift before building.

## Deliverables and acceptance

1. Implement the agreed three flows below using existing UI primitives/tokens.
2. Update `docs/specs/ui/navigation-contract.md`,
   `docs/specs/tech/group-cow-contract.md`, owning product facts and relevant
   screen/component comments and tests. Highlight Product facts in the PR.
3. Add/update Jest proof for saved/unset/loading/error values, manager/member
   visibility, missing setup controls in CoW, focused navigation, refresh after
   first and subsequent saves, and preserved safe failure paths.
4. Capture real app screenshots for relevant roles and saved/unset/error states;
   compare with this design target and link evidence in the implementation PR.
5. Get fresh independent code and separate product reviews, fix findings,
   run agreed gates and all required quality targets, and merge only with
   green GitHub checks. Delete this ephemeral card in the implementation PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read calendar | Open the group main page and read the zone above its control | Current saved IANA zone; members see the value without a management button | Loading/offline/read failure uses existing state and retry; missing data never implies Not set |
| Change calendar | Owner/admin taps Set time zone, edits and saves in the focused existing editor, returns; repeat with another zone | Main page re-reads and shows each saved value | Invalid/offline/conflicting saves retain safe behavior and entered text; lost access/role changes stay guarded |
| Browse/schedule CoW | Open CoW browser/menu and scheduling form | No zone setup control anywhere in this flow; existing published dates/zone stay fixed | Unset group zone cannot publish a schedule |

### Accepted repo-native design target (build input)

On `/group/[groupId]`, below Invite/Edit and above the CoW preview:

```text
Group time zone
Europe/London
[ Set time zone ]
```

The example zone is the actual saved IANA value. Ordinary members see the
label/value without the button. Use existing typography, spacing and secondary
action primitives; Invite remains the primary accent. Existing screens and
repo tokens are the visual baseline; capture reference and comparison images
in the gitignored mobile artifacts tree, not persistent specs.

## Freshness and likely touch points

Planning verified `origin/main` at `675f6c7d`; recheck latest main at execution.

- `apps/mobile/app/group/[groupId]/index.tsx`: management page placement.
- `apps/mobile/app/group/[groupId]/edit.tsx` and
  `apps/mobile/components/groups/cow-time-zone.tsx`: existing focused editor.
- `apps/mobile/app/group/[groupId]/cows/schedule.tsx`: current zone setup action.
- `apps/mobile/src/groups/use-cow-calendar.ts`: online calendar reader;
  do not invent offline cache semantics.
- `apps/mobile/src/groups/cow-wire.ts`: calendar zone/revision/next-week fields.
- `apps/mobile/__tests__/groups-cow-screens.test.tsx`: existing validation and
  scheduling-to-zone navigation assertions; inspect group page tests too.

## Gates

Run `./boga test for` on the final diff; agree the smallest relevant lane set
with an independent reviewer before lanes beyond fast. Expected: `fast`, the
relevant existing `ios-groups-e2e` flow, plus required `jest-coverage`,
`complexity` and `dependencies`. Document every default adjustment. No new
Maestro flow without written justification for what Jest cannot prove.
Load the test-directory README and `docs/specs/writing-tests.md` before edits.
Run `./boga doctor` and fix bootstrap gaps before declaring a gate unavailable;
report only measured timings from `./boga timings`.

## Execution and closeout authorization

Land this card through a docs-only PR before execution. Execute in a separate
session and fresh local worktree from latest main with task-protocol and
ponytail. The human explicitly authorized implementation, opening both PRs
and merging when independent reviews, required local gates and GitHub checks
are clean; no further merge confirmation is needed. Never bypass protections
or merge unresolved findings/failures. Stop the local DB at PR time; verify
each remote merge and release each owned worktree/slot in its own session.
Use the official codex-pr-body skill, repository template and truthful
Codex/model attribution; attach every created PR. Report PRs, checks and cleanup.
