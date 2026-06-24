#!/usr/bin/env bash
#
# use-local-mobile-tailscale-env.sh — the env half of dev-remote.sh.
#
# Outside-the-LAN sibling of use-local-mobile-lan-env.sh. Instead of the Mac's
# LAN IP (same-Wi-Fi only, plain HTTP), it publishes THIS worktree's local
# Supabase over the tailnet as real HTTPS via `tailscale serve`, so a development
# build on a physical phone can reach it from anywhere (cellular included). The
# trusted Let's Encrypt cert on the *.ts.net name is what makes this work without
# a dev-client rebuild: iOS App Transport Security rejects plain HTTP to a 100.x
# Tailscale address in a strict-ATS build (e.g. the com.phano.boga3.dev
# TestFlight build), but accepts the HTTPS endpoint as-is.
#
# Steps:
#   1. resolve this Mac's MagicDNS name        (override: BOGA_MOBILE_TS_HOST=...)
#   2. verify the tailnet has HTTPS certificates enabled (hard prerequisite)
#   3. boot this slot's local Supabase         (local-runtime-up.sh)
#   4. publish Supabase at https://<magicdns>  (tailscale serve)
#   5. rewrite apps/mobile/.env.local EXPO_PUBLIC_SUPABASE_URL/ANON_KEY to it
#
# Metro is published separately by dev-remote.sh (it needs the bundler port). To
# run the pieces yourself, after this script: start Metro on PORT, then
#   tailscale serve --bg --https=8443 http://127.0.0.1:PORT
# and open https://<magicdns>:8443 in the dev client.
#
# Tear down the published endpoints when done:
#   tailscale serve --https=443 off && tailscale serve --https=8443 off
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../supabase/scripts/_common.sh"

MOBILE_ENV_FILE="${REPO_ROOT}/apps/mobile/.env.local"
TS_SUPABASE_HTTPS_PORT=443

require_tailscale_https() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[tailscale] tailscale CLI not found. Install Tailscale and sign in." >&2
    exit 1
  fi
  if ! tailscale status >/dev/null 2>&1; then
    echo "[tailscale] tailnet is not up. Run 'tailscale up' and retry." >&2
    exit 1
  fi
  # `tailscale cert` with no domain is read-only and prints a clear message when
  # the tailnet has no HTTPS support, which `tailscale serve --https` requires.
  # It always exits non-zero here (missing domain arg), so capture its output and
  # match a here-string — piping directly would let `set -o pipefail` mask the
  # grep (the command's failure poisons the pipeline) and the guard never fires.
  local cert_probe
  cert_probe="$(tailscale cert 2>&1 || true)"
  if grep -q "HTTPS cert support is not enabled" <<<"${cert_probe}"; then
    echo "[tailscale] HTTPS certificates are not enabled for your tailnet." >&2
    echo "            Enable them once (free): https://login.tailscale.com/admin/dns" >&2
    echo "            -> turn on MagicDNS, then 'Enable HTTPS'. Then re-run." >&2
    exit 1
  fi
}

detect_tailscale_host() {
  if [[ -n "${BOGA_MOBILE_TS_HOST:-}" ]]; then
    printf '%s\n' "${BOGA_MOBILE_TS_HOST%.}"
    return 0
  fi
  local name
  name="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty')"
  name="${name%.}"
  if [[ -z "${name}" ]]; then
    echo "[tailscale] could not resolve this node's MagicDNS name. Set BOGA_MOBILE_TS_HOST and retry." >&2
    exit 1
  fi
  printf '%s\n' "${name}"
}

rewrite_mobile_supabase_env() {
  local url="$1"
  local tmp_file

  if [[ ! -d "$(dirname "${MOBILE_ENV_FILE}")" ]]; then
    echo "[supabase] mobile app directory not found: $(dirname "${MOBILE_ENV_FILE}")" >&2
    exit 1
  fi

  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' EXIT

  if [[ -f "${MOBILE_ENV_FILE}" ]]; then
    awk '!/^EXPO_PUBLIC_SUPABASE_URL=|^EXPO_PUBLIC_SUPABASE_ANON_KEY=/' "${MOBILE_ENV_FILE}" >"${tmp_file}"
  fi

  {
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${url}"
    printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY}"
  } >>"${tmp_file}"

  mv "${tmp_file}" "${MOBILE_ENV_FILE}"
  trap - EXIT
}

# 1 + 2. Fail fast on tailnet prerequisites BEFORE any Docker/env side effects.
require_tailscale_https
TS_HOST="$(detect_tailscale_host)"

# 3. Boot this slot's local Supabase and read its URL + anon key.
# The dev launchers set BOGA_MOBILE_DEV_DB=1 to target the dedicated dev stack
# (BOGA-dev) instead of the slot-0 gate stack, so a gate run never wipes the
# phone's data. engage_dev_stack points every helper below (status read, serve
# port, env rewrite) at the dev stack; without the flag this is slot-0 as before.
if [[ -n "${BOGA_MOBILE_DEV_DB:-}" ]]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/supabase/scripts/dev-stack-lib.sh"
  engage_dev_stack
  "${REPO_ROOT}/supabase/scripts/dev-runtime-up.sh"
else
  "${REPO_ROOT}/supabase/scripts/local-runtime-up.sh"
fi
load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "[supabase] missing local Supabase API_URL or ANON_KEY after startup" >&2
  exit 1
fi

# 4. Publish Supabase over the tailnet as HTTPS (trusted cert -> no ATS issues).
API_PORT="${API_URL##*:}"
if ! tailscale serve --bg --https="${TS_SUPABASE_HTTPS_PORT}" "http://127.0.0.1:${API_PORT}" >/dev/null 2>&1; then
  echo "[tailscale] 'tailscale serve --https=${TS_SUPABASE_HTTPS_PORT}' failed." >&2
  echo "            You may need 'sudo tailscale serve ...', or confirm HTTPS is enabled for the tailnet." >&2
  exit 1
fi
TS_URL="https://${TS_HOST}"

# 5. Point the mobile app at it.
rewrite_mobile_supabase_env "${TS_URL}"

echo "[supabase] switched mobile Supabase env to tailnet HTTPS: ${MOBILE_ENV_FILE}"
echo "[supabase] url: ${TS_URL}  (serving 127.0.0.1:${API_PORT})"
echo "[supabase] restart Expo/Metro so EXPO_PUBLIC_* values are rebundled"
