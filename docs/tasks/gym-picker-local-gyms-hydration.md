# Gym Picker Local Gyms Hydration

Status: planned

## Objective

Make the mobile session recorder gym picker/manage UI show the user's synced local
`gyms` rows, not only the hardcoded starter locations.

## Background

Investigation found the hosted backend has live `app_public.gyms` rows and
sessions reference those gym ids. The sync contract and targeted sync tests show
`gyms` are part of layer 0 pull/push and can land in SQLite.

The likely bug is UI hydration:

- `apps/mobile/app/(tabs)/session-recorder.tsx` initializes
  `state.locations` from `SEEDED_LOCATIONS`.
- The picker and manager render only `state.locations`.
- `apps/mobile/src/data/local-gyms.ts` exposes `upsertLocalGym` and
  `loadLocalGymById`, but no list-all live gyms read path.
- Completed-session edit appends only the single referenced gym via
  `loadLocalGymById`, so normal picker/manage flows can miss synced gyms already
  present in SQLite.

## Scope

- Add a local repository read for live gyms, likely `listLocalGyms()`.
- Hydrate or merge session-recorder `locations` from that read.
- Preserve current seeded locations and existing in-memory edits where sensible.
- Exclude tombstoned gyms (`deleted_at` non-null) from normal picker/manage views.
- Keep GPS coordinate fields available for matching and manage/editor status.
- Add focused tests proving a non-seeded local/synced gym appears in picker/manage.

## Out of Scope

- Backend schema/RLS changes.
- Sync protocol changes.
- Redesigning archive semantics. The current `archived` UI flag is in-memory only;
  do not invent persistent archive behavior unless needed for the bug fix.

## Verification

Run from repo root unless noted:

- `./scripts/quality-fast.sh`
- Because this touches mobile data hydration around sync-backed rows, also run
  `./scripts/quality-slow.sh backend` if feasible.

If a gate fails for infrastructure/tooling reasons, capture the exact command and
error. Do not report the gate as unavailable without first attempting it.
