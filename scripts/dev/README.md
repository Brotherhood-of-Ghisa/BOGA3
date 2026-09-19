# scripts/dev/ — human-convenience tools

Interactive developer tools for a human at the keyboard. **No gate, agent
workflow, or CI depends on anything in this directory** — agents normally have
no reason to run these.

- `dev-lan.sh` — one-stop local dev for a physical phone on the same Wi-Fi:
  boots this slot's Supabase, points `apps/mobile/.env.local` at the Mac's LAN
  IP, starts Expo/Metro over LAN.
- `use-local-mobile-lan-env.sh` — just the env half of the above (also
  `./boga env lan`).
- `use-local-mobile-dev-env.sh` — point the mobile app at the local dev stack
  (`BOGA-dev`, port 65431) after running the dev baseline (also `./boga env dev`).
  Note: per spec 12, `BOGA-dev` is strictly reserved for slot 0 (the main
  checkout); linked worktrees (slot > 0) must use their own isolated slot
  stack (`./boga db up`).
- `use-hosted-mobile-env.sh` — point the mobile app at hosted Supabase using
  credentials from `supabase/.env.hosted` (also `./boga env hosted`).
- `tag-dev-ios.sh` / `tag-preview-ios.sh` — release bookkeeping for local iOS
  builds: validate an `.ipa`'s bundle id, then git-tag the commit it was built
  from (dev vs preview profile). Usage: `./scripts/dev/tag-dev-ios.sh <path.ipa>`
  (see `apps/mobile/README-LOCAL-DEV-BUILD.md`).
