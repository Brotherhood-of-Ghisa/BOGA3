#!/usr/bin/env bash
#
# dev-lan.sh — one-stop local dev for a physical phone on the same Wi-Fi.
#
# It chains the existing per-step scripts so a real device can talk to THIS
# worktree's local stack:
#   1. ensures this worktree has a generated Supabase config (slot/ports)
#   2. ensures isolated mobile deps are installed (never shared across worktrees)
#   3. boots THIS slot's local Supabase stack (Docker) via local-runtime-up.sh
#   4. rewrites apps/mobile/.env.local to the Mac's LAN IP instead of 127.0.0.1
#      (steps 3+4 are both done by use-local-mobile-lan-env.sh)
#   4.5 ensures the dev DB baseline (ensure-dev-baseline.sh): applies pending
#       migrations in place and seeds the dev sign-in accounts — never resets
#   5. starts Expo/Metro over the LAN so the phone can reach the bundler too
#
# Notes:
#   - Phone and Mac must be on the SAME network.
#   - Supabase containers persist after you Ctrl+C Expo. Stop them with:
#       ./supabase/scripts/local-runtime-down.sh
#   - Override LAN IP auto-detection (en0/en1) when needed:
#       BOGA_MOBILE_LAN_HOST=192.168.1.42 ./scripts/dev-lan.sh
#   - This is a dev-client app (custom native modules + scheme), so Expo starts
#     in --dev-client mode. Extra args are forwarded to `expo start`, e.g.:
#       ./scripts/dev-lan.sh --clear
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"

# Target the dedicated dev Supabase stack (BOGA-dev), not the slot-0 gate stack,
# so running the gates never wipes this phone session's data. The env-half and
# ensure-dev-baseline below both honor this flag. See docs/specs/12.
export BOGA_MOBILE_DEV_DB=1

# 1. Ensure this worktree has a generated Supabase config (slot/project_id/ports).
#    A fresh worktree created via worktree-create.sh already has this; the guard
#    only fires for a checkout that was never set up.
if [[ ! -f "$REPO_ROOT/supabase/config.toml" ]]; then
  echo "[dev-lan] no supabase/config.toml — running worktree setup"
  "$REPO_ROOT/scripts/worktree-setup.sh"
fi

# 2. Ensure isolated mobile deps. Per the worktree contract these must be
#    installed in-place and never symlinked/shared between worktrees.
if [[ ! -d "$MOBILE_DIR/node_modules" ]]; then
  echo "[dev-lan] installing mobile deps (first run in this worktree)"
  (cd "$MOBILE_DIR" && npm install)
fi

# 3 + 4. Boot this slot's local Supabase and point apps/mobile/.env.local at the
#        Mac LAN IP. use-local-mobile-lan-env.sh runs local-runtime-up.sh itself,
#        then rewrites EXPO_PUBLIC_SUPABASE_URL/ANON_KEY to http://<lan-ip>:<port>.
echo "[dev-lan] starting local Supabase and pointing apps/mobile/.env.local at the LAN IP"
"$REPO_ROOT/scripts/dev/use-local-mobile-lan-env.sh"

# 4.5 Ensure the dev DB baseline against the now-running stack: apply any pending
#     migrations IN PLACE (no reset) and seed the human dev accounts
#     (a@dev.local / b@dev.local). Reuses the stack the step above just started,
#     so it never resets your local data. Fails loud on schema drift.
echo "[dev-lan] ensuring dev DB baseline (no reset; seeds dev users)"
"$REPO_ROOT/supabase/scripts/ensure-dev-baseline.sh"

# 5. Start Expo/Metro over the LAN. The env was rewritten in step 4 BEFORE this,
#    so EXPO_PUBLIC_* values are bundled with the LAN URL. --host lan makes the
#    bundler reachable from the phone; --dev-client targets the installed dev
#    client (not Expo Go). Extra args ($@) are forwarded to `expo start`.
echo "[dev-lan] starting Expo over LAN — open the dev client on your phone (same Wi-Fi)"
cd "$MOBILE_DIR"

# Pin the LAN Supabase values into Metro's OWN environment so a later .env.local
# rewrite (a gate run, `boga db up`, a Maestro lane) can't break a live session
# on reload. Mirrors dev-remote.sh; the shared helper documents the @expo/env
# precedence it relies on.
# shellcheck source=scripts/dev/export-mobile-supabase-env.sh
source "$SCRIPT_DIR/export-mobile-supabase-env.sh" "$MOBILE_DIR/.env.local"

exec npx expo start --dev-client --host lan "$@"
