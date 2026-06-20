#!/usr/bin/env bash
#
# dev-remote.sh — one-stop local dev for a physical phone OUTSIDE your LAN.
#
# Outside-the-LAN sibling of dev-lan.sh. Where dev-lan.sh needs the phone on the
# same Wi-Fi (Mac LAN IP, plain HTTP), this routes over your tailnet so the phone
# reaches THIS worktree's local stack from anywhere (cellular included). It uses
# `tailscale serve` to give both Metro and Supabase real HTTPS on the Mac's
# *.ts.net name — which a strict-ATS dev build (com.phano.boga3.dev) requires,
# and which means NO dev-client rebuild: your existing TestFlight build works.
#
# It chains the existing steps:
#   1. ensures this worktree has a generated Supabase config (slot/ports)
#   2. ensures isolated mobile deps are installed
#   3. boots Supabase, publishes it at https://<magicdns>, and rewrites
#      apps/mobile/.env.local to that URL  (use-local-mobile-tailscale-env.sh)
#   4. publishes Metro at https://<magicdns>:8443 via `tailscale serve`
#   5. starts Expo/Metro on a fixed port behind that proxy
#
# Prerequisites (one-time):
#   - Tailscale installed + signed in on BOTH this Mac and the phone (same tailnet)
#   - HTTPS certificates enabled for the tailnet:
#       https://login.tailscale.com/admin/dns  -> MagicDNS on, then "Enable HTTPS"
#
# On the phone: open the dev client and load   https://<magicdns>:8443
#
# Notes:
#   - Override MagicDNS detection:  BOGA_MOBILE_TS_HOST=my-mac.tailnet.ts.net ...
#   - Override the Metro port (default 8081):  EXPO_PORT=8082 ...
#   - Run ONE worktree at a time: the 443/8443 serve mappings are per-machine.
#   - Supabase containers + serve mappings persist after Ctrl+C. Tear down with:
#       ./supabase/scripts/local-runtime-down.sh
#       tailscale serve --https=443 off && tailscale serve --https=8443 off
#   - Extra args are forwarded to `expo start`, e.g. ./scripts/dev/dev-remote.sh --clear
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
EXPO_PORT="${EXPO_PORT:-8081}"
TS_METRO_HTTPS_PORT=8443

# 1. Ensure this worktree has a generated Supabase config (slot/project_id/ports).
if [[ ! -f "$REPO_ROOT/supabase/config.toml" ]]; then
  echo "[dev-remote] no supabase/config.toml — running worktree setup"
  "$REPO_ROOT/scripts/worktree-setup.sh"
fi

# 2. Ensure isolated mobile deps (never symlinked/shared between worktrees).
if [[ ! -d "$MOBILE_DIR/node_modules" ]]; then
  echo "[dev-remote] installing mobile deps (first run in this worktree)"
  (cd "$MOBILE_DIR" && npm install)
fi

# 3. Boot Supabase, publish it over the tailnet, and repoint apps/mobile/.env.local.
#    This also fails fast if the tailnet lacks HTTPS support, before Metro starts.
echo "[dev-remote] starting local Supabase and publishing it over the tailnet (HTTPS)"
"$REPO_ROOT/scripts/dev/use-local-mobile-tailscale-env.sh"

# Resolve the MagicDNS name again for the Metro proxy + dev-client URL.
if [[ -n "${BOGA_MOBILE_TS_HOST:-}" ]]; then
  TS_HOST="${BOGA_MOBILE_TS_HOST%.}"
else
  TS_HOST="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty')"
  TS_HOST="${TS_HOST%.}"
fi
[[ -n "${TS_HOST}" ]] || { echo "[dev-remote] could not resolve MagicDNS name" >&2; exit 1; }

# 4. Publish Metro over the tailnet as HTTPS too, so ATS never blocks the bundler.
echo "[dev-remote] publishing Metro at https://${TS_HOST}:${TS_METRO_HTTPS_PORT} (-> 127.0.0.1:${EXPO_PORT})"
if ! tailscale serve --bg --https="${TS_METRO_HTTPS_PORT}" "http://127.0.0.1:${EXPO_PORT}" >/dev/null 2>&1; then
  echo "[dev-remote] 'tailscale serve --https=${TS_METRO_HTTPS_PORT}' failed (need HTTPS enabled / maybe sudo)." >&2
  exit 1
fi

cat <<EOF
[dev-remote] ready — on your phone's dev client, load:
    https://${TS_HOST}:${TS_METRO_HTTPS_PORT}
  Supabase is at https://${TS_HOST} (already baked into apps/mobile/.env.local).
  Press Ctrl+C to stop Metro. Endpoints stay published; tear down with:
    tailscale serve --https=443 off && tailscale serve --https=${TS_METRO_HTTPS_PORT} off
EOF

# 5. Start Metro on the fixed port behind the proxy. EXPO_PACKAGER_PROXY_URL tells
#    Expo the public URL to advertise, so the dev client fetches the manifest,
#    bundle, and assets over HTTPS through tailscale serve (no http/asset leaks).
cd "$MOBILE_DIR"
export EXPO_PACKAGER_PROXY_URL="https://${TS_HOST}:${TS_METRO_HTTPS_PORT}"

# Pin the tailnet Supabase values into Metro's OWN environment. @expo/env never
# overrides a variable already present in process.env, so even if a later
# Supabase boot (a gate run, `boga db up`, a Maestro lane) rewrites
# apps/mobile/.env.local back to 127.0.0.1 under a live session, the running
# bundle keeps the tailnet URL on reload instead of silently breaking (a phone
# can't reach 127.0.0.1 — that's the phone itself). The anon key is read back
# from the .env.local the env-half just wrote, so the two never drift.
anon_line="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$MOBILE_DIR/.env.local" | head -1 || true)"
export EXPO_PUBLIC_SUPABASE_URL="https://${TS_HOST}"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="${anon_line#EXPO_PUBLIC_SUPABASE_ANON_KEY=}"

exec npx expo start --dev-client --port "$EXPO_PORT" "$@"
