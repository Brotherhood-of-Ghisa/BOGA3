#!/usr/bin/env bash

# Tests for the lane-timing store (scripts/lane-timing.sh + test-timings.sh):
# records land in the machine-global store (never in the worktree), the lane's
# exit code propagates, the reader keys "this machine" on hw + cores + OS name
# (not the OS version), and `import` is idempotent. Hermetic: temp
# BOGA_CONFIG_ROOT, temp repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TIMINGS="${SRC_ROOT}/scripts/test-timings.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
export BOGA_CONFIG_ROOT="${TMP}/config"
unset BOGA_TIMINGS_DIR BOGA_LANE_TIMING
STORE="${BOGA_CONFIG_ROOT}/timings/records"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }
count() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

# A worktree-shaped repo root with a slot lease.
REPO_ROOT="${TMP}/repo"
mkdir -p "${REPO_ROOT}"
git -C "${REPO_ROOT}" init -q
printf '7\n' > "${REPO_ROOT}/.worktree-slot"
export REPO_ROOT

# shellcheck disable=SC1091
source "${SRC_ROOT}/scripts/lane-timing.sh"

# 1. Records go to the store, not the worktree; exit codes propagate.
boga_time_lane green-lane true || fail "a green lane must return 0"
rc=0
boga_time_lane red-lane false || rc=$?
[ "${rc}" = "1" ] || fail "a red lane must propagate its exit code (got ${rc})"
[ "$(count "${STORE}")" = "2" ] || fail "expected 2 records in ${STORE}, got $(count "${STORE}")"
[ "$(count "${REPO_ROOT}/docs")" = "0" ] || fail "no record may land inside the worktree"
green="$(ls "${STORE}"/*.green-lane.json)"
grep -q '"exit_code": 0' "${green}" || fail "green record must carry exit_code 0"
grep -q '"slot": "7"' "${green}" || fail "record must carry the worktree's slot"
grep -q '"exit_code": 1' "${STORE}"/*.red-lane.json || fail "red record must carry exit_code 1"

# 2. BOGA_LANE_TIMING=0 records nothing; BOGA_TIMINGS_DIR overrides the store.
BOGA_LANE_TIMING=0 boga_time_lane off-lane true
[ "$(count "${STORE}")" = "2" ] || fail "BOGA_LANE_TIMING=0 must not record"
BOGA_TIMINGS_DIR="${TMP}/override" boga_time_lane override-lane true
[ "$(count "${TMP}/override")" = "1" ] || fail "BOGA_TIMINGS_DIR must receive the record"

# 3. The reader counts a record from this machine under an older OS version
#    (and an older fingerprint) as this machine's; another machine's is not.
fields="$(boga_timing_machine_fields)"
hw="${fields%%|*}"
cores="$(printf '%s' "${fields}" | cut -d'|' -f2)"
os="${fields##*|}"
now="$(date -u +%Y%m%dT%H%M%SZ)"
write_rec() { # <path> <lane> <hw> <os>
  printf '{"lane": "%s", "wall_ms": 5000, "exit_code": 0, "recorded_at": "%s", "machine_id": "deadbeef", "hw": "%s", "cores": %s, "os": "%s"}\n' \
    "$2" "${now}" "$3" "${cores:-0}" "$4" > "$1"
}
write_rec "${STORE}/old-os.json" old-os-lane "${hw}" "$(boga_timing_os_family "${os}") 0.0.1"
write_rec "${STORE}/other.json" other-lane "Some Other CPU" "${os}"

out="$("${TIMINGS}")"
printf '%s' "${out}" | grep -q "this machine" || fail "reader must scope to this machine: ${out}"
printf '%s' "${out}" | grep -q "old-os-lane" || fail "an older OS version must still count as this machine"
printf '%s' "${out}" | grep -q "other-lane" && fail "another machine's record must not count as this machine's"
"${TIMINGS}" --all-machines | grep -q "other-lane" || fail "--all-machines must include other machines"

# 4. import copies new files, skips existing ones, never overwrites.
SRC="${TMP}/legacy"
mkdir -p "${SRC}"
printf 'changed' > "${SRC}/old-os.json"  # same name as a stored record
write_rec "${SRC}/legacy-new.json" legacy-lane "${hw}" "${os}"
out="$("${TIMINGS}" import "${SRC}")"
printf '%s' "${out}" | grep -q "1 added, 1 already present" || fail "first import: ${out}"
grep -q '"lane": "old-os-lane"' "${STORE}/old-os.json" || fail "import must never overwrite an existing record"
out="$("${TIMINGS}" import "${SRC}")"
printf '%s' "${out}" | grep -q "0 added, 2 already present" || fail "import must be idempotent: ${out}"

echo "  lane-timing: all assertions passed"
