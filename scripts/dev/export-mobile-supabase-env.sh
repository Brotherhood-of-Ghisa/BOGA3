#!/usr/bin/env bash
#
# export-mobile-supabase-env.sh — pin the mobile app's EXPO_PUBLIC_SUPABASE_*
# values from a just-written .env.local into the CURRENT shell, so they are
# present in process.env before `expo start`.
#
# Why: @expo/env loads .env files but never overrides a variable already defined
# in the environment (node_modules/@expo/env: "is already defined and IS NOT
# overwritten"). Pinning the values here means a running Metro keeps them even if
# a later Supabase boot — a gate run, `boga db up`, a Maestro lane — rewrites
# apps/mobile/.env.local back to 127.0.0.1. Without it, a live device session
# silently breaks on the next reload: a phone resolves 127.0.0.1 to itself, not
# the Mac. Shared by dev-lan.sh and dev-remote.sh so both flows behave the same.
#
# Contract: SOURCE this (do not execute it), and only AFTER the env-half
# (use-local-mobile-lan-env.sh / use-local-mobile-tailscale-env.sh) has written
# .env.local. Pass the .env.local path as $1:
#
#   source "$SCRIPT_DIR/export-mobile-supabase-env.sh" "$MOBILE_DIR/.env.local"
#
# It never `exit`s (that would kill the sourcing shell); on a missing file it
# warns and leaves the variables unset, so `expo start` still falls back to the
# .env.local on disk.

__bmse_env_file="${1:-}"

if [[ -z "$__bmse_env_file" || ! -f "$__bmse_env_file" ]]; then
  echo "[export-mobile-supabase-env] env file not found: ${__bmse_env_file:-<unset>} — skipping pin" >&2
else
  __bmse_url="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$__bmse_env_file" | head -1 || true)"
  __bmse_anon="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$__bmse_env_file" | head -1 || true)"
  export EXPO_PUBLIC_SUPABASE_URL="${__bmse_url#EXPO_PUBLIC_SUPABASE_URL=}"
  export EXPO_PUBLIC_SUPABASE_ANON_KEY="${__bmse_anon#EXPO_PUBLIC_SUPABASE_ANON_KEY=}"
  echo "[export-mobile-supabase-env] pinned EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL} into Metro env"
fi

unset __bmse_env_file __bmse_url __bmse_anon
