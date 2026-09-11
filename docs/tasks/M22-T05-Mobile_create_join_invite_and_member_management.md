---
task_id: M22-T05-Mobile_create_join_invite_and_member_management
milestone_id: "M22"
status: in_progress
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md, docs/specs/tech/groups-contract.md"
---

# M22-T05 — Mobile: create, edit, join, invite, members and roles

## Task metadata

- Task ID: `M22-T05-Mobile_create_join_invite_and_member_management`
- Status: `in_progress`
- Depends on: `M22-T04` (screens to extend), `M22-T03`

## Parent references (required)

- Milestone spec: `docs/specs/milestones/M22-groups-and-foundations.md` (FR 1,
  3, 4, 5, 9; C7.4)
- **Contract:** `docs/specs/tech/groups-contract.md`
  - §4.3: the write RPCs and role matrix;
  - §6.3: routes, the username gate, share, and the known limitation.
- UX standard: `docs/specs/08-ux-delivery-standard.md` (destructive action
  safety pattern); UI docs: `docs/specs/ui/README.md`
- Profile API: `apps/mobile/src/auth/profile.ts` (`loadUserProfile`,
  `saveUsername`)

## Objective

Ship every group write flow in the app:

- create and edit a group;
- join by code or by the `boga3://group/join?code=` link, with a preview;
- see, share, and regenerate the invite (owner and admins only);
- promote, demote, transfer, remove, and leave;
- the inline username gate;
- a clear offline error for every write.

## Scope

### In scope

- **Routes:** `app/group/new.tsx`, `app/group/[groupId]/edit.tsx` (a shared
  form component), `app/group/join.tsx`, and `app/group/[groupId]/invite.tsx`.
- **Groups tab:** the header actions (My groups, Create group, Join group) and
  the empty-state primary actions.
- **Group screen:** role-gated actions — Invite, Edit, Leave, and a per-member
  action sheet (Make admin / Remove admin / Transfer ownership / Remove).
- **`components/groups/username-gate.tsx`.**
- **Share:** React Native core `Share.share`. No new native dependency.

### Out of scope

Group delete/restore. Sharing controls. Return-to after sign-in for invite
links (a documented limitation).

## UX Contract

### Key user flows

1. **Create a group**
   - Trigger: Create group from the Groups tab (header or empty state).
   - Steps:
     1. If the username is blank, the inline username field shows first; save
        it, then continue.
     2. Enter a name (1–50) and an optional description (≤280).
     3. Tap Create.
   - Success outcome: the new group screen opens as owner, with the Invite
     action prominent (C3.3.2).
   - Failure/edge outcome: inline validation; offline shows a clear error and
     creates nothing (AC12); `USERNAME_REQUIRED` from the server re-opens the
     gate.
2. **Invite**
   - Trigger: Invite on the group screen (owner or admin).
   - Steps: the code is shown large; Share opens the share sheet with the code
     and `boga3://group/join?code=…`; Regenerate asks for confirmation ("The
     old code stops working").
   - Success outcome: the code is shared, or a new code is shown.
   - Failure/edge outcome: members never see Invite (C7.4); offline regenerate
     is an error with no change.
3. **Join**
   - Trigger: Join group, or opening the invite link (the code is prefilled).
   - Steps:
     1. The username gate runs if needed.
     2. Enter or confirm the code.
     3. The preview shows the group name and member count.
     4. Tap Join.
   - Success outcome: the group screen opens, and the stream shows "joined".
     Already a member opens the group.
   - Failure/edge outcome: an invalid or regenerated code shows "This invite
     code isn't valid" (AC4); offline shows an error.
4. **Manage members**
   - Trigger: tap a member row on the group screen.
   - Steps: the action sheet offers only the actions allowed for my role and
     the target (§4.3); destructive actions (Remove, Transfer) ask for
     confirmation.
   - Success outcome: the list updates in place; removal shows "X was
     removed" in the stream.
   - Failure/edge outcome: a server `FORBIDDEN` or `NOT_FOUND` shows inline
     feedback and a refresh; offline shows an error with no change.
5. **Edit and leave**
   - Trigger: Edit (owner or admin), or Leave (non-owner).
   - Steps: edit uses the shared form; Leave asks for confirmation.
   - Success outcome: leaving returns to the Groups tab, and the group
     disappears from chips and My groups.
   - Failure/edge outcome: the owner sees Leave replaced by "Transfer
     ownership before leaving" (C3.6.5).

### Interaction + appearance notes

- Destructive actions use the danger `UiButton` and a confirmation prompt
  (the destructive action safety pattern).
- The invite code is selectable, has testID `group-invite-code` (used by the
  `M22-T06` flow), and shows in a large monospace-like style from tokens.
- Username-gate errors appear inline next to the field.

## Acceptance criteria

1. Flows 1–5 are implemented, and each has jest/RNTL happy-path and
   failure-path assertions (AC1–AC4, AC10 UI gating, AC12).
2. **Role gating matches §4.3 exactly.** A test renders each role and target
   combination and asserts the offered actions.
3. The deep link `boga3://group/join?code=ABCD2345` opens the Join screen with
   the code prefilled. A jest router test covers the route params, and the
   Maestro coverage is in `T06`.
4. The UI docs are updated. No raw colors are introduced.

## Docs touched (required)

- UI docs update required: **yes**.
  - `ui/screen-map.md` and `ui/navigation-contract.md` — the new routes, the
    deep link, and the transitions;
  - `ui/components-catalog.md` — the username gate and the member action
    sheet;
  - `ui/ux-rules.md` — the online-only write error convention.
- `docs/specs/tech/groups-contract.md`: **As-built** notes on §6.3 for the
  write screens.
- **Screenshots required:**
  - the create form with the username gate;
  - the invite screen;
  - the join preview;
  - the invalid-code error;
  - the member action sheet for each role;
  - the offline write error.

## Testing and verification approach

`./boga test fast` and `./boga test frontend`.

## Evidence

- **Jest** (RPCs and the profile API mocked; real `group_cache` on the
  in-memory SQLite fixture):
  - `groups-write-view-model.test.ts`: the §4.3 matrix for every (my role,
    target) pair (AC2); Invite/Edit/Leave gating; confirmation only for
    Remove/Transfer; validation bounds; the share text; error wording.
  - `groups-write-screens.test.tsx` (30 tests), covering flows 1–5 happy and
    failure paths:
    - the gate first, then create → `replace('/group/<id>')` (AC1, AC2);
    - inline validation; `USERNAME_REQUIRED` re-opens the gate and keeps the
      draft;
    - deep-link param preview, then join; `INVITE_INVALID` (AC4); already a
      member → `Open group`;
    - share, and regenerate confirm/cancel; member → no code (C7.4);
    - edit prefill and save; member forbidden;
    - owner/admin/member screens render the exact actions (AC10 UI gating);
    - remove/transfer confirmation; FORBIDDEN → inline plus refresh;
    - leave → evict plus `dismissTo('/groups')`;
    - every write offline → refused with no RPC (AC12).
  - `groups-join-deep-link.test.tsx`: the real Expo Router resolves
    `/group/join?code=ABCD2345` to Join (not `[groupId]`), with the params
    and the preview (AC3).
- **Gates at `5d657b6`** (on `origin/main` `d0a251e`), all green:
  - `./boga test fast`: every lane exits 0, and jest-full passes 1220 tests.
  - `./boga test handles`: exit 0.
  - `boga test frontend`, under `apps/mobile/artifacts/maestro/ad-hoc/`:
    - `ios-smoke`: `20260911-175846-99584`;
    - `ios-data-smoke`: `20260911-180122-6606`. The first attempt,
      `20260911-175934-2255`, failed before any group code ran: the app was
      not in the foreground after the harness deep link. The rerun passed.
    - `ios-auth-profile`: `20260911-180241-8818`;
    - `ios-sync-e2e`: `20260911-180407-11134`.
- **Screenshots**, real data on this worktree's local Supabase:
  - Location: `apps/mobile/artifacts/m22-t05-screenshots/m22t05-*.png`
    (gitignored), from run
    `artifacts/maestro/ad-hoc/20260911-174841-t05-evidence`.
  - Setup: per-run users provisioned with `auth-provision-user.sh`, signed
    in through GoTrue, and `group_*` RPCs called over REST. The device user
    started with a blank username. No app code was patched.
  - Create: `02-create-username-gate`, `03-…-inline-error`,
    `04-create-form-validation`, `05-create-form-filled`, and
    `06-new-group-owner-invite-prominent`.
  - Invite: `07-invite-screen`, `08-invite-regenerate-confirm`, and
    `09-invite-regenerated`.
  - Owner sheets: `11-owner-sheet-on-admin`, `12-owner-sheet-on-member`,
    `13-owner-remove-confirm`, `14-owner-removed-feedback`, and
    `15-stream-was-removed`.
  - Join: `16-join-preview-from-link` (opened via
    `boga3://group/join?code=…`), `17-joined-group-stream`, and
    `19-join-regenerated-code-invalid` (the group's pre-regenerate code,
    AC4).
  - Other roles: `18-member-view-no-actions` and `21-admin-sheet-on-member`.
  - Offline and leave: `22-leave-confirm`,
    `23-offline-leave-error`, and `24-left-back-on-groups-tab`.
    - `23` was taken with only this slot's `supabase_kong_…-wt2` container
      stopped, which is a real transport failure. A REST check afterwards
      confirmed the membership was unchanged.
    - The NetInfo-offline refusal is proven in jest, because the simulator
      network cannot be toggled (contract §8).

## Completion note

- What changed:
  - Routes `app/group/{new,join}.tsx` and
    `app/group/[groupId]/{edit,invite}.tsx`.
  - Groups tab Join/Create; empty-state actions on the tab and My groups.
  - Group screen: Invite/Edit, Leave or the owner notice, and the member
    action sheet.
  - `components/groups/{username-gate,group-details-form,member-action-sheet,write-notice}.tsx`.
  - `src/groups/{write-view-model,evict-local}.ts`.
  - UI docs, 08 pattern 9, and the contract §6.3 as-built note.
- What tests ran: see Evidence.
- What remains:
  - The M22-T06 two-user Maestro lane (it uses `group-invite-code`).
  - Return-to after sign-in for invite links: the known limitation, out of
    scope.
