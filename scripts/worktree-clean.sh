#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-lib.sh"

SLOT=""
SUPABASE=0
REMOVE_REGISTRY=0
DRY_RUN=0
FORCE=0

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-clean.sh --slot <n> [options]

Cleans local infrastructure for a completed BOGA worktree slot.

Options:
  --supabase          Remove Supabase containers and volumes for the slot project id.
  --remove-registry   Remove ~/.config/boga/worktrees/slots/<slot> after cleanup.
  --dry-run           Print actions without removing anything.
  --force             Allow cleaning the current worktree slot.
  -h, --help          Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slot)
      SLOT="${2:-}"
      [[ -n "$SLOT" ]] || { echo "[worktree-clean] --slot requires a value" >&2; exit 2; }
      shift 2
      ;;
    --supabase)
      SUPABASE=1
      shift
      ;;
    --remove-registry)
      REMOVE_REGISTRY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[worktree-clean] unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$SLOT" ]] || { echo "[worktree-clean] missing --slot" >&2; usage >&2; exit 2; }
boga_validate_slot_value "$SLOT" >/dev/null

if [[ "$SUPABASE" != "1" && "$REMOVE_REGISTRY" != "1" ]]; then
  echo "[worktree-clean] nothing selected; pass --supabase and/or --remove-registry" >&2
  exit 2
fi

CURRENT_SLOT="$(boga_worktree_slot_or_default "$REPO_ROOT")"
if [[ "$SLOT" == "$CURRENT_SLOT" && "$FORCE" != "1" ]]; then
  echo "[worktree-clean] refusing to clean current worktree slot $SLOT without --force" >&2
  exit 1
fi

CONFIG_ROOT="$(boga_config_root)"
REGISTRY_FILE="$CONFIG_ROOT/worktrees/slots/$SLOT"
PROJECT_IDS=()
if PROJECT_ID="$(boga_registry_project_id_from_file "$REGISTRY_FILE" 2>/dev/null)"; then
  :
else
  REGISTRY_PATH="$(boga_registry_path_from_file "$REGISTRY_FILE" 2>/dev/null || true)"
  if [[ -n "$REGISTRY_PATH" && -d "$REGISTRY_PATH" ]]; then
    PROJECT_ID="$(boga_project_id_for_slot "$SLOT" "$REGISTRY_PATH")"
  else
    PROJECT_ID="$(boga_project_id_for_slot "$SLOT" "$REPO_ROOT")"
  fi
fi
PROJECT_IDS+=("$PROJECT_ID")
LEGACY_PROJECT_ID="$(boga_legacy_project_id_for_slot "$SLOT")"
if [[ "$LEGACY_PROJECT_ID" != "$PROJECT_ID" ]]; then
  PROJECT_IDS+=("$LEGACY_PROJECT_ID")
fi
LOCK_DIR="$CONFIG_ROOT/worktrees/runtime-locks/$SLOT.lock"
LOCK_TIMEOUT_SECONDS="${BOGA_CLEAN_LOCK_TIMEOUT_SECONDS:-30}"

run_or_print() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[worktree-clean] dry-run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

release_lock() {
  if [[ -d "$LOCK_DIR" ]]; then
    rm -f "$LOCK_DIR/owner.pid" "$LOCK_DIR/created_at"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_DIR")"

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
      echo "[worktree-clean] timed out waiting for slot $SLOT runtime lock. Holder: $holder" >&2
      exit 1
    fi

    sleep 1
  done

  printf '%s\n' "$$" >"$LOCK_DIR/owner.pid"
  printf '%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"$LOCK_DIR/created_at"
  trap release_lock EXIT
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

cleanup_supabase() {
  local project_id
  local containers=()
  local volumes=()
  local networks=()
  local container_id volume_name network_id

  if ! docker_available; then
    echo "[worktree-clean] docker is unavailable; skipping Supabase cleanup for slot $SLOT" >&2
    return 0
  fi

  for project_id in "${PROJECT_IDS[@]}"; do
    containers=()
    while IFS= read -r container_id; do
      [[ -n "$container_id" ]] && containers+=("$container_id")
    done < <(docker ps -aq --filter "label=com.supabase.cli.project=$project_id")
    if (( ${#containers[@]} > 0 )); then
      echo "[worktree-clean] removing Supabase containers for $project_id: ${containers[*]}"
      run_or_print docker rm -f "${containers[@]}"
    else
      echo "[worktree-clean] no Supabase containers found for $project_id"
    fi

    volumes=()
    while IFS= read -r volume_name; do
      [[ -n "$volume_name" ]] && volumes+=("$volume_name")
    done < <(docker volume ls -q --filter "label=com.supabase.cli.project=$project_id")
    if (( ${#volumes[@]} > 0 )); then
      echo "[worktree-clean] removing Supabase volumes for $project_id: ${volumes[*]}"
      run_or_print docker volume rm -f "${volumes[@]}"
    else
      echo "[worktree-clean] no Supabase volumes found for $project_id"
    fi

    networks=()
    while IFS= read -r network_id; do
      [[ -n "$network_id" ]] && networks+=("$network_id")
    done < <(docker network ls -q --filter "label=com.supabase.cli.project=$project_id")
    if (( ${#networks[@]} > 0 )); then
      echo "[worktree-clean] removing Supabase networks for $project_id: ${networks[*]}"
      run_or_print docker network rm "${networks[@]}"
    else
      echo "[worktree-clean] no Supabase networks found for $project_id"
    fi
  done
}

acquire_lock

if [[ "$SUPABASE" == "1" ]]; then
  cleanup_supabase
fi

if [[ "$REMOVE_REGISTRY" == "1" ]]; then
  if [[ -f "$REGISTRY_FILE" ]]; then
    if [[ "$DRY_RUN" == "1" ]]; then
      run_or_print rm -f "$REGISTRY_FILE"
    else
      rm -f "$REGISTRY_FILE"
      echo "[worktree-clean] removed slot registry: $REGISTRY_FILE"
    fi
  fi
fi

echo "[worktree-clean] done for slot $SLOT ($PROJECT_ID)"
