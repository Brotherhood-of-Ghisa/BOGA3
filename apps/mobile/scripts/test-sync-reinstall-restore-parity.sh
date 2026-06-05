#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"

# shellcheck disable=SC1091
source "$REPO_ROOT/supabase/scripts/_common.sh"
# shellcheck disable=SC1091
source "$REPO_ROOT/supabase/scripts/auth-fixture-constants.sh"

echo "[sync-reinstall-restore-parity] ensuring worktree local Supabase baseline"
"$REPO_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"

load_supabase_status_env

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "[sync-reinstall-restore-parity] missing API_URL or ANON_KEY from local Supabase status" >&2
  exit 1
fi

export EXPO_PUBLIC_SUPABASE_URL="$API_URL"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SYNC_TEST_EMAIL="${SYNC_TEST_EMAIL:-$USER_A_EMAIL}"
export SYNC_TEST_PASSWORD="${SYNC_TEST_PASSWORD:-$USER_A_PASSWORD}"

cd "$APP_DIR"
npm test -- --config jest.integration.config.js --runInBand
