#!/usr/bin/env bash

# ./boga worktree doctor — read-only diagnostics for this worktree: placement,
# slot lease, expected vs configured ports, shared-config symlinks, deps.
# Changes nothing; exits non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

STATUS=0

ok() {
  echo "[ok] $*"
}

warn() {
  echo "[warn] $*" >&2
}

fail() {
  echo "[fail] $*" >&2
  STATUS=1
}

toml_value() {
  local section="$1"
  local key="$2"
  local file="$3"

  awk -v section="$section" -v key="$key" '
    $0 == "[" section "]" { in_section = 1; next }
    /^\[/ { in_section = 0 }
    in_section && $1 == key {
      value = $0
      sub(/^[^=]+=[[:space:]]*/, "", value)
      gsub(/"/, "", value)
      print value
      exit
    }
  ' "$file"
}

check_port_listener() {
  local label="$1"
  local port="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not available; skipping listener check for $label port $port"
    return 0
  fi

  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "$label port $port currently has a listener; this is expected only if this slot's runtime is running"
  else
    ok "$label port $port has no active listener"
  fi
}

echo "BOGA worktree doctor"
echo "  repo: $(boga_abs_dir "$REPO_ROOT")"
echo "  config root: $(boga_config_root)"
echo "  default worktree root: $(boga_worktree_root)"

if boga_validate_worktree_placement "$REPO_ROOT"; then
  ok "worktree is not nested inside another BOGA checkout"
else
  fail "worktree placement is unsafe"
fi

if slot="$(boga_read_slot_file "$REPO_ROOT" 2>/dev/null)"; then
  ok "slot file: $slot"
else
  fail "no valid .worktree-slot; run ./boga worktree start"
  slot="0"
fi

if lease_error="$(boga_require_slot_lease "$REPO_ROOT" 2>&1)"; then
  ok "slot lease valid: $(boga_registry_file "$slot")"
else
  fail "slot lease invalid:"
  printf '       %s\n' "$lease_error" >&2
fi

echo "  expected project_id: $(boga_project_id_for_slot "$slot" "$REPO_ROOT")"
echo "  expected ports:"
echo "    supabase api: $(boga_port_for_slot api "$slot")"
echo "    supabase db: $(boga_port_for_slot db "$slot")"
echo "    supabase studio: $(boga_port_for_slot studio "$slot")"
echo "    edge inspector: $(boga_port_for_slot inspector "$slot")"
echo "    expo dev server: $(boga_port_for_slot expo "$slot")"

CONFIG_FILE="$REPO_ROOT/supabase/config.toml"
if [[ -f "$CONFIG_FILE" ]]; then
  project_id="$(awk -F\" '/^project_id =/ { print $2; exit }' "$CONFIG_FILE")"
  api_port="$(toml_value api port "$CONFIG_FILE")"
  db_port="$(toml_value db port "$CONFIG_FILE")"
  studio_port="$(toml_value studio port "$CONFIG_FILE")"

  [[ "$project_id" == "$(boga_project_id_for_slot "$slot" "$REPO_ROOT")" ]] \
    && ok "supabase project_id matches slot" \
    || fail "supabase project_id '$project_id' does not match slot $slot; run ./boga worktree start"

  # Docker Compose truncates project names at 40 characters, so a long worktree
  # name yields containers named for a prefix of project_id. The scripts handle
  # that truncation, but two worktrees whose ids agree in their first 40
  # characters would share one Docker project — which is a real collision, not a
  # cosmetic one. Say so here rather than letting it surface as a reset failure.
  if (( ${#project_id} > 40 )); then
    warn "supabase project_id is ${#project_id} chars; Docker truncates to '${project_id:0:40}' — a shorter worktree name avoids any chance of colliding with another slot"
  fi
  [[ "$api_port" == "$(boga_port_for_slot api "$slot")" ]] \
    && ok "supabase api port matches slot" \
    || fail "supabase api port '$api_port' does not match slot $slot; run ./boga worktree start"
  [[ "$db_port" == "$(boga_port_for_slot db "$slot")" ]] \
    && ok "supabase db port matches slot" \
    || fail "supabase db port '$db_port' does not match slot $slot; run ./boga worktree start"
  [[ "$studio_port" == "$(boga_port_for_slot studio "$slot")" ]] \
    && ok "supabase studio port matches slot" \
    || fail "supabase studio port '$studio_port' does not match slot $slot; run ./boga worktree start"
  if [[ -f "$REPO_ROOT/supabase/config.toml.template" && "$REPO_ROOT/supabase/config.toml.template" -nt "$CONFIG_FILE" ]]; then
    fail "supabase/config.toml is older than its template; run ./boga worktree start"
  fi
else
  fail "missing supabase/config.toml; run ./boga worktree start"
fi

for local_file in \
  "$REPO_ROOT/supabase/.env.local" \
  "$REPO_ROOT/supabase/.env.hosted" \
  "$REPO_ROOT/supabase/functions/.env.local"; do
  if [[ -L "$local_file" ]]; then
    ok "shared config symlink: $local_file -> $(readlink "$local_file")"
  elif [[ -e "$local_file" ]]; then
    warn "non-symlink local config file: $local_file"
  else
    fail "missing local config path: $local_file; run ./boga worktree start"
  fi
done

supabase_cli_version="$(boga_supabase_cli_version "$REPO_ROOT")"
if boga_version_at_least "$supabase_cli_version" "$BOGA_SUPABASE_CLI_MIN_VERSION"; then
  ok "Supabase CLI $supabase_cli_version (>= $BOGA_SUPABASE_CLI_MIN_VERSION: edge runtime boots without deno.land)"
else
  fail "Supabase CLI $supabase_cli_version is below $BOGA_SUPABASE_CLI_MIN_VERSION: 'supabase start' 502s when deno.land is unreachable; remove or raise SUPABASE_CLI_VERSION in $(boga_config_root)/supabase/cli.env"
fi

MAESTRO_ENV="$REPO_ROOT/apps/mobile/.maestro/maestro.env.local"
if [[ -f "$MAESTRO_ENV" ]]; then
  if grep -q "^EXPO_DEV_SERVER_PORT=.*$(boga_port_for_slot expo "$slot")" "$MAESTRO_ENV"; then
    ok "Maestro env contains expected Expo port"
  else
    warn "Maestro env exists but may not use expected Expo port $(boga_port_for_slot expo "$slot")"
  fi
else
  fail "missing $MAESTRO_ENV; run ./boga worktree start"
fi

if [[ -L "$REPO_ROOT/apps/mobile/node_modules" ]]; then
  fail "apps/mobile/node_modules is a symlink; each worktree must own its own install"
elif [[ -d "$REPO_ROOT/apps/mobile/node_modules" ]]; then
  ok "apps/mobile/node_modules is worktree-local"
else
  warn "apps/mobile/node_modules is missing; gates install it on first run"
fi

check_port_listener "Supabase API" "$(boga_port_for_slot api "$slot")"
check_port_listener "Supabase DB" "$(boga_port_for_slot db "$slot")"
check_port_listener "Expo dev server" "$(boga_port_for_slot expo "$slot")"

if [[ "$STATUS" == "0" ]]; then
  echo "[worktree-doctor] passed"
else
  echo "[worktree-doctor] failed" >&2
fi

exit "$STATUS"
