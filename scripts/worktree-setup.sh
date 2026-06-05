#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

GENERATE_CONFIG_ONLY=0
REQUESTED_SLOT=""
FORCE_SLOT=0

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-setup.sh [options]

Initializes the current BOGA checkout/worktree for isolated local runtime use.

Options:
  --generate-config-only   Regenerate supabase/config.toml from the current slot.
  --slot <n>               Assign a specific slot (0-99) when no slot is set.
  --force-slot             Allow --slot to replace an existing local slot file.
  -h, --help               Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --generate-config-only)
      GENERATE_CONFIG_ONLY=1
      shift
      ;;
    --slot)
      REQUESTED_SLOT="${2:-}"
      [[ -n "$REQUESTED_SLOT" ]] || { echo "[worktree-setup] --slot requires a value" >&2; exit 2; }
      shift 2
      ;;
    --force-slot)
      FORCE_SLOT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[worktree-setup] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

CONFIG_ROOT="$(boga_config_root)"
REGISTRY_DIR="$CONFIG_ROOT/worktrees/slots"
LOCK_DIR="$CONFIG_ROOT/worktrees/slot-allocation.lock"
LOCK_TIMEOUT_SECONDS="${BOGA_SLOT_LOCK_TIMEOUT_SECONDS:-120}"
SLOT_FILE="$REPO_ROOT/.worktree-slot"

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
      echo "[worktree-setup] timed out waiting for slot allocation lock. Holder: $holder" >&2
      exit 1
    fi

    sleep 1
  done

  printf '%s\n' "$$" >"$LOCK_DIR/owner.pid"
  printf '%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"$LOCK_DIR/created_at"
  trap release_lock EXIT
}

add_used_slot() {
  local used_file="$1"
  local slot="$2"
  boga_validate_slot_value "$slot" >/dev/null 2>&1 || return 0
  if ! grep -qx "$slot" "$used_file" 2>/dev/null; then
    printf '%s\n' "$slot" >>"$used_file"
  fi
}

slot_is_used() {
  local used_file="$1"
  local slot="$2"
  grep -qx "$slot" "$used_file" 2>/dev/null
}

registered_slot_for_current_path() {
  local registry_file slot registered_path current_path
  current_path="$(boga_abs_dir "$REPO_ROOT")"

  for registry_file in "$REGISTRY_DIR"/*; do
    [[ -f "$registry_file" ]] || continue
    slot="$(basename "$registry_file")"
    boga_validate_slot_value "$slot" >/dev/null 2>&1 || continue
    registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
    [[ -n "$registered_path" ]] || continue
    if [[ -d "$registered_path" ]] && [[ "$(boga_abs_dir "$registered_path")" == "$current_path" ]]; then
      printf '%s\n' "$slot"
      return 0
    fi
  done

  return 1
}

collect_used_slots() {
  local used_file="$1"
  local registry_file slot registered_path line worktree_path candidate_slot

  : >"$used_file"

  for registry_file in "$REGISTRY_DIR"/*; do
    [[ -f "$registry_file" ]] || continue
    slot="$(basename "$registry_file")"
    if ! boga_validate_slot_value "$slot" >/dev/null 2>&1; then
      rm -f "$registry_file"
      continue
    fi
    registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
    if [[ -n "$registered_path" && -d "$registered_path" ]]; then
      add_used_slot "$used_file" "$slot"
    else
      rm -f "$registry_file"
    fi
  done

  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        worktree_path="${line#worktree }"
        if [[ -f "$worktree_path/.worktree-slot" ]]; then
          candidate_slot="$(tr -d '[:space:]' <"$worktree_path/.worktree-slot")"
          add_used_slot "$used_file" "$candidate_slot"
        elif [[ -d "$worktree_path" ]] \
          && [[ "$(boga_abs_dir "$worktree_path")" != "$(boga_abs_dir "$REPO_ROOT")" ]] \
          && ! boga_is_linked_git_worktree "$worktree_path"; then
          add_used_slot "$used_file" "0"
        fi
        ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain)
}

assert_slot_available_for_current_path() {
  local slot="$1"
  local registry_file="$REGISTRY_DIR/$slot"
  local registered_path current_path

  current_path="$(boga_abs_dir "$REPO_ROOT")"
  [[ -f "$registry_file" ]] || return 0

  registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
  if [[ -z "$registered_path" || ! -d "$registered_path" ]]; then
    rm -f "$registry_file"
    return 0
  fi

  if [[ "$(boga_abs_dir "$registered_path")" == "$current_path" ]]; then
    return 0
  fi

  echo "[worktree-setup] slot $slot is already registered to $registered_path" >&2
  return 1
}

choose_slot() {
  local used_file="$1"
  local max_slot slot
  max_slot="$(boga_max_slot)"

  if [[ -n "$REQUESTED_SLOT" ]]; then
    boga_validate_slot_value "$REQUESTED_SLOT" || exit 1
    assert_slot_available_for_current_path "$REQUESTED_SLOT" || exit 1
    printf '%s\n' "$REQUESTED_SLOT"
    return 0
  fi

  if slot="$(registered_slot_for_current_path)"; then
    printf '%s\n' "$slot"
    return 0
  fi

  slot=0
  while (( slot <= max_slot )); do
    if ! slot_is_used "$used_file" "$slot"; then
      printf '%s\n' "$slot"
      return 0
    fi
    slot="$(( slot + 1 ))"
  done

  echo "[worktree-setup] no free BOGA worktree slots remain in range 0-$max_slot" >&2
  exit 1
}

remove_current_path_registrations_except() {
  local keep_slot="$1"
  local registry_file slot registered_path current_path
  current_path="$(boga_abs_dir "$REPO_ROOT")"

  for registry_file in "$REGISTRY_DIR"/*; do
    [[ -f "$registry_file" ]] || continue
    slot="$(basename "$registry_file")"
    [[ "$slot" == "$keep_slot" ]] && continue
    registered_path="$(boga_registry_path_from_file "$registry_file" 2>/dev/null || true)"
    [[ -n "$registered_path" && -d "$registered_path" ]] || continue
    if [[ "$(boga_abs_dir "$registered_path")" == "$current_path" ]]; then
      rm -f "$registry_file"
    fi
  done
}

ensure_slot() {
  local existing_slot used_file selected_slot selected_project_id tmp_file

  if [[ -f "$SLOT_FILE" ]]; then
    existing_slot="$(boga_read_slot_file "$REPO_ROOT")"
    if [[ -n "$REQUESTED_SLOT" && "$REQUESTED_SLOT" != "$existing_slot" && "$FORCE_SLOT" != "1" ]]; then
      echo "[worktree-setup] existing slot $existing_slot differs from requested slot $REQUESTED_SLOT" >&2
      echo "[worktree-setup] pass --force-slot only if you intend to regenerate this worktree's local runtime identity" >&2
      exit 1
    fi
    if [[ -n "$REQUESTED_SLOT" && "$REQUESTED_SLOT" != "$existing_slot" ]]; then
      boga_validate_slot_value "$REQUESTED_SLOT" || exit 1
      assert_slot_available_for_current_path "$REQUESTED_SLOT" || exit 1
      selected_slot="$REQUESTED_SLOT"
    else
      selected_slot="$existing_slot"
    fi
  else
    used_file="$(mktemp)"
    collect_used_slots "$used_file"
    selected_slot="$(choose_slot "$used_file")"
    rm -f "$used_file"
  fi

  tmp_file="$(mktemp)"
  printf '%s\n' "$selected_slot" >"$tmp_file"
  mv "$tmp_file" "$SLOT_FILE"
  remove_current_path_registrations_except "$selected_slot"
  selected_project_id="$(boga_project_id_for_slot "$selected_slot" "$REPO_ROOT")"
  {
    printf 'slot=%s\n' "$selected_slot"
    printf 'project_id=%s\n' "$selected_project_id"
    printf 'path=%s\n' "$(boga_abs_dir "$REPO_ROOT")"
    printf 'common_git_dir=%s\n' "$(boga_common_git_dir "$REPO_ROOT")"
    printf 'updated_at=%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  } >"$REGISTRY_DIR/$selected_slot"
  printf '%s\n' "$selected_slot"
}

generate_supabase_config() {
  local slot="$1"
  local template="$REPO_ROOT/supabase/config.toml.template"
  local config="$REPO_ROOT/supabase/config.toml"
  local tmp_file

  [[ -f "$template" ]] || { echo "[worktree-setup] missing template: $template" >&2; exit 1; }

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
    echo "[worktree-setup] linked $link_path -> $target_path"
    return 0
  fi

  if [[ -e "$link_path" ]]; then
    echo "[worktree-setup] keeping existing non-symlink local file: $link_path" >&2
    echo "[worktree-setup] migrate it manually to $target_path when ready" >&2
    return 0
  fi

  ln -s "$target_path" "$link_path"
  echo "[worktree-setup] linked $link_path -> $target_path"
}

ensure_maestro_env() {
  local slot="$1"
  local local_env="$REPO_ROOT/apps/mobile/.maestro/maestro.env.local"
  local sample_env="$REPO_ROOT/apps/mobile/.maestro/maestro.env.sample"
  local expo_port build_root app_path tmp_file

  [[ -f "$sample_env" ]] || { echo "[worktree-setup] missing Maestro sample env: $sample_env" >&2; exit 1; }

  if [[ -f "$local_env" ]]; then
    echo "[worktree-setup] keeping existing Maestro env: $local_env"
    return 0
  fi

  expo_port="$(boga_port_for_slot expo "$slot")"
  build_root="\$HOME/.cache/boga/maestro/ios-dev-client/wt$slot"
  app_path="\$MAESTRO_IOS_SHARED_BUILD_ROOT/mobile-dev-client.app"
  tmp_file="$(mktemp)"

  {
    printf '# Generated by ./scripts/worktree-setup.sh for BOGA worktree slot %s.\n' "$slot"
    printf '# Edit IOS_SIM_UDID after creating or choosing a dedicated simulator.\n\n'
    printf 'TASK_ID="${TASK_ID:-ad-hoc}"\n\n'
    printf 'MAESTRO_IOS_SHARED_BUILD_ROOT="${MAESTRO_IOS_SHARED_BUILD_ROOT:-%s}"\n' "$build_root"
    printf 'MAESTRO_IOS_DEV_CLIENT_APP_PATH="${MAESTRO_IOS_DEV_CLIENT_APP_PATH:-%s}"\n\n' "$app_path"
    printf 'IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-BOGA wt%s}"\n' "$slot"
    printf 'IOS_SIM_UDID="${IOS_SIM_UDID:-}"\n\n'
    printf 'IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-1}"\n\n'
    printf 'EXPO_DEV_SERVER_PORT="${EXPO_DEV_SERVER_PORT:-%s}"\n' "$expo_port"
    printf 'EXPO_START_WAIT_SECONDS="${EXPO_START_WAIT_SECONDS:-30}"\n'
    printf 'MAESTRO_KEEP_SIMULATOR_BOOTED="${MAESTRO_KEEP_SIMULATOR_BOOTED:-0}"\n'
  } >"$tmp_file"

  mv "$tmp_file" "$local_env"
  echo "[worktree-setup] created Maestro env: $local_env"
}

install_post_checkout_hook() {
  local common_dir hooks_dir hook_source configured_hooks_path primary_worktree line

  common_dir="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"
  case "$common_dir" in
    /*) ;;
    *) common_dir="$REPO_ROOT/$common_dir" ;;
  esac
  common_dir="$(boga_abs_dir "$common_dir")"
  hooks_dir="$common_dir/hooks"
  mkdir -p "$hooks_dir"

  hook_source="$REPO_ROOT/hooks/post-checkout"
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        primary_worktree="${line#worktree }"
        if [[ -f "$primary_worktree/hooks/post-checkout" ]]; then
          hook_source="$primary_worktree/hooks/post-checkout"
        fi
        break
        ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain)

  if [[ ! -f "$hook_source" ]]; then
    echo "[worktree-setup] missing hook source: $hook_source" >&2
    exit 1
  fi

  if [[ -e "$hooks_dir/post-checkout" && ! -L "$hooks_dir/post-checkout" ]]; then
    echo "[worktree-setup] existing non-symlink hook left unchanged: $hooks_dir/post-checkout" >&2
  else
    ln -sfn "$hook_source" "$hooks_dir/post-checkout"
    echo "[worktree-setup] installed shared post-checkout hook: $hooks_dir/post-checkout"
  fi

  configured_hooks_path="$(git -C "$REPO_ROOT" config --get core.hooksPath || true)"
  if [[ -n "$configured_hooks_path" ]]; then
    echo "[worktree-setup] warning: core.hooksPath is set to '$configured_hooks_path'; Git may ignore $hooks_dir/post-checkout" >&2
  fi
}

print_summary() {
  local slot="$1"

  cat <<EOF
[worktree-setup] ready
  root:       $REPO_ROOT
  slot:       $slot
  project_id: $(boga_project_id_for_slot "$slot" "$REPO_ROOT")
  supabase:   api=$(boga_port_for_slot api "$slot") db=$(boga_port_for_slot db "$slot") studio=$(boga_port_for_slot studio "$slot")
  expo:       $(boga_port_for_slot expo "$slot")
  doctor:     ./scripts/worktree-doctor.sh
EOF
}

boga_validate_worktree_placement "$REPO_ROOT" || exit 1

if [[ "$GENERATE_CONFIG_ONLY" == "1" ]]; then
  if [[ ! -f "$SLOT_FILE" ]] && boga_is_linked_git_worktree "$REPO_ROOT"; then
    echo "[worktree-setup] linked worktree has no .worktree-slot; run ./scripts/worktree-setup.sh first" >&2
    exit 1
  fi
  slot="$(boga_worktree_slot_or_default "$REPO_ROOT")"
  generate_supabase_config "$slot"
  echo "[worktree-setup] regenerated supabase/config.toml for slot $slot"
  exit 0
fi

"$SCRIPT_DIR/boga-config-init.sh"

acquire_lock
slot="$(ensure_slot)"
generate_supabase_config "$slot"

ensure_symlink "$REPO_ROOT/supabase/.env.hosted" "$CONFIG_ROOT/supabase/env.hosted"
ensure_symlink "$REPO_ROOT/supabase/.env.local" "$CONFIG_ROOT/supabase/cli.env"
ensure_symlink "$REPO_ROOT/supabase/functions/.env.local" "$CONFIG_ROOT/edge-functions/env.shared"
ensure_maestro_env "$slot"
install_post_checkout_hook

print_summary "$slot"
