# scripts/dev/ — human-convenience tools

Interactive developer tools for a human at the keyboard. **No gate, agent
workflow, or CI depends on anything in this directory** — agents normally have
no reason to run these.

- `dev-lan.sh` — one-stop local dev for a physical phone on the same Wi-Fi:
  boots this slot's Supabase, points `apps/mobile/.env.local` at the Mac's LAN
  IP, starts Expo/Metro over LAN.
- `use-local-mobile-lan-env.sh` — just the env half of the above (also
  `./boga env lan`).
- `use-hosted-mobile-env.sh` — point the mobile app at hosted Supabase using
  credentials from `supabase/.env.hosted` (also `./boga env hosted`).
- `tag-dev-ios.sh` / `tag-preview-ios.sh` — release bookkeeping for local iOS
  builds: validate an `.ipa`'s bundle id, then git-tag the commit it was built
  from (dev vs preview profile). Usage: `./scripts/dev/tag-dev-ios.sh <path.ipa>`
  (see `apps/mobile/README-LOCAL-DEV-BUILD.md`).
