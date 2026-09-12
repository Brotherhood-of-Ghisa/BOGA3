#!/usr/bin/env bash

# ./boga worktree start — take (or re-assert) this worktree's slot lease and
# generate its local config. The only command that creates a lease.
# Contract: docs/specs/12-worktree-config-and-isolation.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

BASE_REF=""

usage() {
  cat <<'EOF'
Usage: ./boga worktree start [--base <ref>]

Takes this worktree's slot lease (or re-asserts the one it has) and generates
supabase/config.toml, the Maestro env, and the shared-config symlinks.

A NEW lease in a linked worktree requires HEAD to contain the latest
origin/main (fetched first). Re-running start keeps the slot and skips that
check. The main checkout always gets slot 0.

Options:
  --base <ref>   Check HEAD against <ref> instead of origin/main (no fetch).
                 Use only when told to branch from something else.
  -h, --help     Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="${2:-}"
      [[ -n "$BASE_REF" ]] || { echo "[worktree-start] --base requires a value" >&2; exit 2; }
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[worktree-start] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

CONFIG_ROOT="$(boga_config_root)"
REGISTRY_DIR="$(boga_registry_dir)"
LOCK_DIR="$CONFIG_ROOT/worktrees/slot-allocation.lock"
LOCK_TIMEOUT_SECONDS="${BOGA_SLOT_LOCK_TIMEOUT_SECONDS:-120}"
SLOT_FILE="$REPO_ROOT/.worktree-slot"
ROOT_ABS="$(boga_abs_dir "$REPO_ROOT")"

fail() {
  echo "[worktree-start] $*" >&2
  exit 1
}

release_lock() {
  if [[ -d "$LOCK_DIR" ]]; then
    rm -f "$LOCK_DIR/owner.pid" "$LOCK_DIR/created_at"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_DIR")" "$REGISTRY_DIR"

  local started_at now holder
  started_at="$(date +%s)"

  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ -f "$LOCK_DIR/owner.pid" ]]; then
      holder="$(cat "$LOCK_DIR/owner.pid" 2>/dev/null || true)"
      if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
        rm -rf "$LOCK_DIR"
        continue
      fi
    fi

    now="$(date +%s)"
    if (( now - started_at >= LOCK_TIMEOUT_SECONDS )); then
      holder="unknown"
      [[ -f "$LOCK_DIR/owner.pid" ]] && holder="$(cat "$LOCK_DIR/owner.pid" 2>/dev/null || echo unknown)"
      fail "timed out waiting for slot allocation lock. Holder: $holder"
    fi

    sleep 1
  done

  printf '%s\n' "$$" >"$LOCK_DIR/owner.pid"
  printf '%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"$LOCK_DIR/created_at"
  trap release_lock EXIT
}

# A new lease must start from the latest origin/main (or the explicit --base).
check_base() {
  local ref="$BASE_REF"

  if [[ -z "$ref" ]]; then
    ref="origin/main"
    echo "[worktree-start] fetching origin main"
    git -C "$REPO_ROOT" fetch --quiet origin main \
      || fail "git fetch origin main failed; fix the network/remote and retry (or --base <ref> if told to)"
  fi

  git -C "$REPO_ROOT" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || fail "unknown base ref: $ref"

  if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$ref" HEAD; then
    cat >&2 <<EOF
[worktree-start] HEAD does not contain $ref, so this worktree is not based on it.
[worktree-start] Fix:  git rebase $ref   then re-run ./boga worktree start
[worktree-start] Only if you were told to branch from something else: --base <ref>
EOF
    exit 1
  fi
  echo "[worktree-start] base ok: HEAD contains $ref"
}

lease_holder() {
  boga_registry_field "$(boga_registry_file "$1")" path 2>/dev/null || true
}

lowest_free_slot() {
  local slot=1 max_slot
  max_slot="$(boga_max_slot)"
  while (( slot <= max_slot )); do
    if [[ ! -e "$(boga_registry_file "$slot")" ]]; then
      printf '%s\n' "$slot"
      return 0
    fi
    slot=$((slot + 1))
  done
  fail "no free slot in 1-$max_slot: every registry file is taken (./boga worktree ls; docs/procedures/worktree-cleanup.md)"
}

write_lease() {
  local slot="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  {
    printf 'slot=%s\n' "$slot"
    printf 'project_id=%s\n' "$(boga_project_id_for_slot "$slot" "$REPO_ROOT")"
    printf 'path=%s\n' "$ROOT_ABS"
    printf 'common_git_dir=%s\n' "$(boga_common_git_dir "$REPO_ROOT")"
    printf 'updated_at=%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  } >"$tmp_file"
  mv "$tmp_file" "$(boga_registry_file "$slot")"
}

generate_supabase_config() {
  local slot="$1"
  local template="$REPO_ROOT/supabase/config.toml.template"
  local config="$REPO_ROOT/supabase/config.toml"
  local tmp_file

  [[ -f "$template" ]] || fail "missing template: $template"

  export PROJECT_ID
  export API_PORT DB_PORT SHADOW_PORT STUDIO_PORT INBUCKET_PORT ANALYTICS_PORT POOLER_PORT INSPECTOR_PORT

  PROJECT_ID="$(boga_project_id_for_slot "$slot" "$REPO_ROOT")"
  API_PORT="$(boga_port_for_slot api "$slot")"
  DB_PORT="$(boga_port_for_slot db "$slot")"
  SHADOW_PORT="$(boga_port_for_slot shadow "$slot")"
  STUDIO_PORT="$(boga_port_for_slot studio "$slot")"
  INBUCKET_PORT="$(boga_port_for_slot inbucket "$slot")"
  ANALYTICS_PORT="$(boga_port_for_slot analytics "$slot")"
  POOLER_PORT="$(boga_port_for_slot pooler "$slot")"
  INSPECTOR_PORT="$(boga_port_for_slot inspector "$slot")"

  tmp_file="$(mktemp)"
  perl -pe '
    s/\{\{PROJECT_ID\}\}/$ENV{PROJECT_ID}/g;
    s/\{\{API_PORT\}\}/$ENV{API_PORT}/g;
    s/\{\{DB_PORT\}\}/$ENV{DB_PORT}/g;
    s/\{\{SHADOW_PORT\}\}/$ENV{SHADOW_PORT}/g;
    s/\{\{STUDIO_PORT\}\}/$ENV{STUDIO_PORT}/g;
    s/\{\{INBUCKET_PORT\}\}/$ENV{INBUCKET_PORT}/g;
    s/\{\{ANALYTICS_PORT\}\}/$ENV{ANALYTICS_PORT}/g;
    s/\{\{POOLER_PORT\}\}/$ENV{POOLER_PORT}/g;
    s/\{\{INSPECTOR_PORT\}\}/$ENV{INSPECTOR_PORT}/g;
  ' "$template" >"$tmp_file"
  mv "$tmp_file" "$config"
}

ensure_symlink() {
  local link_path="$1"
  local target_path="$2"

  mkdir -p "$(dirname "$link_path")"

  if [[ -L "$link_path" ]]; then
    ln -sfn "$target_path" "$link_path"
    return 0
  fi

  if [[ -e "$link_path" ]]; then
    echo "[worktree-start] keeping existing non-symlink local file: $link_path" >&2
    return 0
  fi

  ln -s "$target_path" "$link_path"
  echo "[worktree-start] linked $link_path -> $target_path"
}

# Regenerated with every new lease (its Expo port and simulator name are
# slot-derived); kept on a re-run so a hand-set IOS_SIM_UDID survives.
write_maestro_env() {
  local slot="$1"
  local regenerate="$2"
  local local_env="$REPO_ROOT/apps/mobile/.maestro/maestro.env.local"
  local sample_env="$REPO_ROOT/apps/mobile/.maestro/maestro.env.sample"
  local tmp_file

  [[ -f "$sample_env" ]] || fail "missing Maestro sample env: $sample_env"

  if [[ -f "$local_env" && "$regenerate" != "1" ]]; then
    return 0
  fi

  tmp_file="$(mktemp)"
  {
    printf '# Generated by ./boga worktree start for BOGA worktree slot %s.\n' "$slot"
    printf '# Edit IOS_SIM_UDID after creating or choosing a dedicated simulator.\n\n'
    printf 'TASK_ID="${TASK_ID:-ad-hoc}"\n\n'
    printf '# The iOS dev-client build cache is SHARED across all worktrees: a single\n'
    printf '# host-local location owned by apps/mobile/scripts/maestro-env.sh, so a fresh\n'
    printf '# worktree reuses an already-built client. Do NOT pin a per-worktree build\n'
    printf '# root here. After a NATIVE dependency or app.config.ts native-field change,\n'
    printf '# rebuild with `./boga ios build-client --force`.\n\n'
    printf 'IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-BOGA wt%s}"\n' "$slot"
    printf 'IOS_SIM_UDID="${IOS_SIM_UDID:-}"\n\n'
    printf 'IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-1}"\n\n'
    printf 'EXPO_DEV_SERVER_PORT="${EXPO_DEV_SERVER_PORT:-%s}"\n' "$(boga_port_for_slot expo "$slot")"
    printf 'EXPO_START_WAIT_SECONDS="${EXPO_START_WAIT_SECONDS:-30}"\n'
    printf 'MAESTRO_KEEP_SIMULATOR_BOOTED="${MAESTRO_KEEP_SIMULATOR_BOOTED:-0}"\n'
  } >"$tmp_file"
  mv "$tmp_file" "$local_env"
  echo "[worktree-start] wrote Maestro env: $local_env"
}

# ---------- main ----------

boga_validate_worktree_placement "$REPO_ROOT" || exit 1

LINKED=0
boga_is_linked_git_worktree "$REPO_ROOT" && LINKED=1

NEW_LEASE=0
if [[ -e "$SLOT_FILE" ]]; then
  slot="$(boga_read_slot_file "$REPO_ROOT")" \
    || fail "invalid $SLOT_FILE; delete it and re-run ./boga worktree start"
  if [[ "$LINKED" == "1" && "$slot" == "0" ]]; then
    fail "a linked worktree cannot hold slot 0 (the main checkout's); delete $SLOT_FILE and re-run"
  fi
  if [[ "$LINKED" == "0" && "$slot" != "0" ]]; then
    fail "the main checkout must hold slot 0, not $slot; delete $SLOT_FILE and re-run"
  fi
else
  NEW_LEASE=1
  [[ "$LINKED" == "1" ]] && check_base
fi

"$SCRIPT_DIR/boga-config-init.sh" >/dev/null

acquire_lock

if [[ "$NEW_LEASE" == "1" ]]; then
  if [[ "$LINKED" == "1" ]]; then
    slot="$(lowest_free_slot)"
  else
    slot=0
  fi
fi

holder="$(lease_holder "$slot")"
if [[ -n "$holder" && "$holder" != "$ROOT_ABS" ]]; then
  fail "slot $slot is leased to another path: $holder (./boga worktree ls; docs/specs/12-worktree-config-and-isolation.md failure hypothesis 1)"
fi

write_lease "$slot"
printf '%s\n' "$slot" >"$SLOT_FILE"
release_lock
trap - EXIT

generate_supabase_config "$slot"
ensure_symlink "$REPO_ROOT/supabase/.env.hosted" "$CONFIG_ROOT/supabase/env.hosted"
ensure_symlink "$REPO_ROOT/supabase/.env.local" "$CONFIG_ROOT/supabase/cli.env"
ensure_symlink "$REPO_ROOT/supabase/functions/.env.local" "$CONFIG_ROOT/edge-functions/env.shared"
write_maestro_env "$slot" "$NEW_LEASE"

cat <<EOF
[worktree-start] $( [[ "$NEW_LEASE" == "1" ]] && echo "leased" || echo "kept" ) slot $slot
  root:       $ROOT_ABS
  project_id: $(boga_project_id_for_slot "$slot" "$REPO_ROOT")
  supabase:   api=$(boga_port_for_slot api "$slot") db=$(boga_port_for_slot db "$slot") studio=$(boga_port_for_slot studio "$slot")
  expo:       $(boga_port_for_slot expo "$slot")
  lease:      $(boga_registry_file "$slot")
  when your PR merges or closes: ./boga worktree release
EOF
