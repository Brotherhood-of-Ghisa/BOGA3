#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
source "${REPO_ROOT}/scripts/runtime-guard.sh"
boga_runtime_guard_script "$REPO_ROOT" "$0" "$@"

ensure_tmp_dir

echo "[supabase] stopping local edge function server (health) if running"
stop_functions_serve_if_running

echo "[supabase] stopping local stack"
run_supabase stop

echo "[supabase] local runtime stopped"
