# Manual wipe: upgrading from v1 sync to v2

This runbook covers the one-time local-database wipe required when
upgrading any installation of BOGA3 from the v1 sync stack to the v2
sync stack shipped by `docs/plans/sync-v2-client/`.

## Why this is needed

v2 replaces the v1 sync schema wholesale. The v1 tables
`sync_outbox_events` and `sync_delivery_state` are dropped; the
`sync_runtime_state` singleton is recreated with v2-canonical columns
(`pull_cursor`, `last_emitted_ms`, `bootstrap_completed_at`,
`applied_seed_migration_app_version`); every entity gains
`local_dirty` and `local_updated_at_ms`; and five entities gain a
`deleted_at` column. v1 entity rows have none of those columns
populated and v1 `sync_runtime_state` rows carry columns that no
longer exist. Rather than ship an auto-migration code path with a
version-marker module — which would add first-boot ordering
constraints relative to the Drizzle migrator and re-open two design
questions plan 2 explicitly closed (`d1` marker storage, `d2`
migration approach) — plan 2 assumes a **clean local SQLite on first
v2 launch**. Every dev, every TestFlight tester, and (eventually)
every production user performs the one-time wipe documented below.
The v2 build ships with no in-app marker, no auto-wipe, and no
first-boot detection logic.

## iOS Simulator

Two paths. Either works; pick whichever is faster.

**(a) Erase the whole simulator state.**

In Xcode: `Device` → `Erase All Content and Settings…` against the
booted simulator. Confirm. The simulator reboots clean — every app
sandbox, every installed app, every saved photo is gone. This is the
heavy hammer; use it if you also want to drop saved logins, photos,
or test data from other apps.

**(b) Delete only the BOGA3 app from the home screen.**

On the simulator's home screen, long-press the BOGA3 icon (or hold
`Option` while clicking and dragging) until icons jiggle, then tap
the `×` (or `Remove App` → `Delete App`). The simulator deletes the
app sandbox, including the SQLite file at
`Library/LocalDatabase/<db>.db`. Reinstall the dev client
(`./scripts/maestro-ios-dev-client-build.sh` from `apps/mobile/`)
or relaunch from Expo and the app boots against an empty local DB.

## Android Emulator

Two paths.

**(a) Clear app storage.**

In the running emulator: `Settings` → `Apps` → `BOGA3` → `Storage` →
`Clear Storage` (NOT `Clear Cache` — that only nukes derived files,
not the SQLite DB). Confirm. Relaunch BOGA3; it boots against an
empty local DB.

**(b) Wipe the whole emulator.**

In Android Studio's `Device Manager` (formerly `AVD Manager`): right-
click the emulator entry → `Wipe Data`. Boot the emulator again; it
comes up fresh and you reinstall the app from scratch.

## Physical device (iOS and Android)

Uninstall the existing BOGA3 build, then reinstall the v2 build.

- **iOS:** long-press the BOGA3 icon → `Remove App` → `Delete App`,
  or use `Settings` → `General` → `iPhone Storage` → `BOGA3` →
  `Delete App`. Then reinstall from TestFlight (see next section)
  or via Xcode.
- **Android:** long-press the BOGA3 icon → `App info` → `Uninstall`,
  or use `Settings` → `Apps` → `BOGA3` → `Uninstall`. Then
  reinstall from the Play Store internal-testing track or via
  `adb install`.

Both platforms delete the entire app sandbox on uninstall, including
the SQLite file. A fresh install starts clean.

## TestFlight

Testers receiving the v2 build for the first time must do this in
order:

1. **Delete the existing v1 BOGA3 build from the device first.**
   Long-press the icon → `Remove App` → `Delete App`. This step is
   load-bearing and is the easiest one to skip.
2. Open TestFlight, find the new BOGA3 build, install it fresh.

**Do NOT update in place.** TestFlight's `UPDATE` button preserves
the app sandbox across the install; the v2 build then boots against
a v1-shaped local DB and exhibits undefined behaviour (see next
section). Updating in place is the single most common failure mode
for this rollout — always uninstall first.

## What "undefined behaviour" means

If the v2 build boots against a v1-shaped local DB: rows may fail to
sync (dirty bits are not set on pre-v2 entity rows so the cycle
never picks them up), `sync_runtime_state.pull_cursor` may be
missing or empty so the layered pull starts from the beginning of
the world, and the push/pull cycle may diverge from the server.
Diagnosis almost always lands on "the local DB was not wiped" — wipe
per one of the procedures above and re-bootstrap fixes it.
