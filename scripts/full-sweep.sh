#!/usr/bin/env bash

# full-sweep.sh — run EVERY gate lane against the latest origin/main.
#
#   ./boga sweep                          # update the sweep worktree to origin/main, run all lanes
#   ./boga sweep --ref origin/<branch>    # sweep a pushed branch instead (a risky PR, pre-merge)
#   ./boga sweep --dry-run                # print what it would run, run nothing
#
# Why: PR gates are selective (scripts/triggers.tsv). A screen/component change
# runs `boga test frontend-ui`, not the Supabase-backed e2e lanes, so a
# cross-screen regression those lanes would catch can land on main. The sweep
# is the backstop: it runs the fast, backend, and frontend lanes on a ref, so
# such a regression surfaces before it ships instead of at the next unrelated PR
# that happens to trigger the lane. Run opportunistically, not on a schedule:
# on the main commit about to become an iOS build, and on large or shared-UI
# PRs (`boga test for` recommends it) — spec 02.
#
# It owns a dedicated, long-lived, detached worktree (default
# $(boga_worktree_root)/full-sweep, override with BOGA_SWEEP_DIR) with its own
# slot lease — never the caller's checkout. Each run: fetch, check out the
# ref (default origin/main) detached, re-assert the lease, run every lane (continuing past
# failures so one red lane doesn't hide another), stop the slot's Supabase
# stack. Logs + summary land in $(boga_config_root)/sweep/<UTC timestamp>/.
#
# Exit: 0 when every lane is green, 1 when any lane is red, 2 on setup failure.
# The dev client is the shared host cache; a native-dependency change on main
# must already have rebuilt it (spec 02) — a sweep that fails at boot with
# `Cannot find native module` is reporting exactly that gap.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/worktree-lib.sh"

DRY=0
IN_PLACE=0
REF="origin/main"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --ref) REF="${2:?--ref needs a ref}"; shift ;;
    --in-place) IN_PLACE=1 ;;  # internal: already running inside the updated sweep worktree
    -h|--help) sed -n '3,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[sweep] unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

SWEEP_DIR="${BOGA_SWEEP_DIR:-$(boga_worktree_root)/full-sweep}"
say() { echo "[sweep] $*"; }
die() { echo "[sweep] $*" >&2; exit 2; }

# The lanes a sweep runs, in order: every fast lane, then backend, then
# frontend. Backend before frontend: the iOS lanes leave server rows that the
# backend contract lanes don't expect.
sweep_lanes() {
  grep -v '^[[:space:]]*#' "$1/scripts/lanes.tsv" | grep -v '^[[:space:]]*$' \
    | awk -F'\t' '
        $2 ~ /^fast-/        { fast = fast $1 "\n" }
        $2 == "slow-backend"  { be = be $1 "\n" }
        $2 == "slow-frontend" { fe = fe $1 "\n" }
        END { printf "%s%s%s", fast, be, fe }'
}

# ---------- phase 1: bring the sweep worktree to the ref, then re-exec its copy ----------
if [[ "${IN_PLACE}" != "1" ]]; then
  if [[ "${DRY}" == "1" ]]; then
    say "would update ${SWEEP_DIR} to ${REF} and run, in order:"
    sweep_lanes "${REPO_ROOT}" | sed 's|^|  ./boga test |'
    exit 0
  fi

  LOCK="$(boga_config_root)/sweep.lock"
  mkdir -p "$(boga_config_root)"
  mkdir "${LOCK}" 2>/dev/null || die "another sweep holds ${LOCK} (remove it if no sweep is running)"
  trap 'rmdir "${LOCK}" 2>/dev/null || true' EXIT

  if [[ -d "${SWEEP_DIR}" ]]; then
    git -C "${SWEEP_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      || die "${SWEEP_DIR} exists but is not a git worktree"
    if [[ -n "$(git -C "${SWEEP_DIR}" status --porcelain --untracked-files=no)" ]]; then
      die "${SWEEP_DIR} has tracked modifications — the sweep only runs a pristine ref; inspect and clean it by hand"
    fi
    say "updating ${SWEEP_DIR} to ${REF}"
    git -C "${SWEEP_DIR}" fetch --quiet origin
    git -C "${SWEEP_DIR}" checkout --quiet --detach "${REF}"
    "${SWEEP_DIR}/scripts/worktree-start.sh" >/dev/null || die "worktree start failed in ${SWEEP_DIR}"
  else
    say "creating the sweep worktree at ${SWEEP_DIR}"
    git -C "${REPO_ROOT}" fetch --quiet origin
    "${REPO_ROOT}/scripts/worktree-create.sh" --detach --from "${REF}" --root "$(dirname "${SWEEP_DIR}")" \
      --name "$(basename "${SWEEP_DIR}")" || die "could not create ${SWEEP_DIR}"
  fi

  # Run the swept ref's copy of this script, so the sweep logic matches the code.
  set +e
  BOGA_SWEEP_DIR="${SWEEP_DIR}" "${SWEEP_DIR}/scripts/full-sweep.sh" --in-place --ref "${REF}"
  status=$?
  set -e
  exit "${status}"
fi

# ---------- phase 2: inside the sweep worktree ----------
[[ "$(boga_abs_dir "${REPO_ROOT}")" == "$(boga_abs_dir "${SWEEP_DIR}")" ]] \
  || die "--in-place must run from the sweep worktree (${SWEEP_DIR}), not ${REPO_ROOT}"

COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
OUT="$(boga_config_root)/sweep/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${OUT}"
SUMMARY="${OUT}/summary.txt"

# Refresh mobile deps when main's lockfile moved (the lanes only install when
# node_modules is missing, which a long-lived worktree never is).
LOCK_STAMP="${REPO_ROOT}/apps/mobile/node_modules/.sweep-lock-sha"
lock_sha="$(git -C "${REPO_ROOT}" hash-object apps/mobile/package-lock.json)"
if [[ ! -d "${REPO_ROOT}/apps/mobile/node_modules" || "$(cat "${LOCK_STAMP}" 2>/dev/null)" != "${lock_sha}" ]]; then
  say "installing apps/mobile deps (lockfile changed)"
  (cd "${REPO_ROOT}/apps/mobile" && npm ci) >"${OUT}/npm-ci.log" 2>&1 \
    || die "npm ci failed — see ${OUT}/npm-ci.log"
  printf '%s\n' "${lock_sha}" >"${LOCK_STAMP}"
fi

say "${REF} @ ${COMMIT} — logs: ${OUT}"
{
  echo "BOGA full sweep — ${REF} @ ${COMMIT} — started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
} >"${SUMMARY}"

red=0
while IFS= read -r lane; do
  [[ -n "${lane}" ]] || continue
  start=$(date +%s)
  if "${REPO_ROOT}/boga" test "${lane}" >"${OUT}/${lane}.log" 2>&1; then
    result="GREEN"
  else
    result="RED  "
    red=1
  fi
  line="$(printf '%s  %-22s %4ss  %s' "${result}" "${lane}" "$(( $(date +%s) - start ))" "${OUT}/${lane}.log")"
  echo "${line}" >>"${SUMMARY}"
  say "${line}"
done < <(sweep_lanes "${REPO_ROOT}")

"${REPO_ROOT}/boga" db down >"${OUT}/db-down.log" 2>&1 || say "WARN: db down failed (see ${OUT}/db-down.log)"

{
  echo
  if [[ "${red}" == "1" ]]; then
    echo "RESULT: RED — ${REF} has a regression the PR gates did not catch. Bisect with ./boga test <lane>."
  else
    echo "RESULT: GREEN"
  fi
} >>"${SUMMARY}"
ln -sfn "${OUT}" "$(boga_config_root)/sweep/latest"
cat "${SUMMARY}"
exit "${red}"
