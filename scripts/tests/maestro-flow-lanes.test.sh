#!/usr/bin/env bash

# maestro-flow-lanes.test.sh — enforces "every committed flow belongs to a
# lane": each apps/mobile/.maestro/flows/*.yaml must be named by a lane runner,
# so some gate actually runs it.
#
# Why this exists: a flow no lane runs is covered by no gate and no CI, so
# nothing reports when it stops matching the app. It silently rots and is then
# found broken at the moment someone needs it. When this rule was first applied,
# six of the repo's flows were unlaned and four of them were already failing
# (stale assertions, chip ids that no longer existed, heatmap cells pinned to
# calendar dates months in the past).
#
# A flow is "laned" when a runner names its file: maestro-run-lane.sh (the
# per-lane entrypoint) or maestro-ios-gates.sh (the combined infra-free gates).
# Both resolve to lanes in scripts/lanes.tsv.
#
# Infra-free: greps the flow directory and the runners; runs no app / simulator
# / Supabase. Part of the `meta-tests` lane (and CI). Self-tests the rule on
# synthetic trees first, then checks the real repo.
#
# Contract: docs/specs/06-testing-strategy.md ("Every committed flow belongs to
# a lane").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# check_tree <flows-dir> <runner>...: fails on the first unlaned flow.
check_tree() {
  local flows_dir="$1"; shift
  local runners=("$@")
  [[ -d "${flows_dir}" ]] || fail "flows dir not found: ${flows_dir}"
  local r
  for r in "${runners[@]}"; do
    [[ -f "${r}" ]] || fail "runner not found: ${r}"
  done

  local flow name laned count=0
  for flow in "${flows_dir}"/*.yaml; do
    [[ -e "${flow}" ]] || fail "no flows found in ${flows_dir} — the glob likely broke"
    name="$(basename -- "${flow}")"
    laned=0
    for r in "${runners[@]}"; do
      # Fixed-string match on the file name: a runner references a flow by its
      # basename, whatever path prefix it builds around it.
      if grep -qF -- "${name}" "${r}"; then
        laned=1
        break
      fi
    done
    [[ "${laned}" == "1" ]] \
      || fail "${name} is run by no lane — wire it into a runner (and scripts/lanes.tsv), or delete it. See docs/specs/06-testing-strategy.md."
    count=$((count + 1))
  done

  echo "  maestro-flow-lanes: ${count} flow(s), each named by a lane runner"
}

# --- self-tests on synthetic trees ---------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

make_tree() {
  mkdir -p "$1/flows"
  printf 'appId: x\n---\n- launchApp\n' >"$1/flows/alpha.yaml"
  printf 'run_flow full "Alpha" alpha.yaml\n' >"$1/runner.sh"
  printf '# no flows here\n' >"$1/other.sh"
}

expect_check() {
  local expected="$1" label="$2" dir="$3" out
  if out="$( (check_tree "${dir}/flows" "${dir}/runner.sh" "${dir}/other.sh") 2>&1 )"; then
    [[ "${expected}" == pass ]] || fail "self-test '${label}': expected a violation, got: ${out}"
  else
    [[ "${expected}" == fail ]] || fail "self-test '${label}': expected a pass, got: ${out}"
  fi
  echo "  self-test ok (${expected}): ${label}"
}

make_tree "${TMP}/ok"
expect_check pass "every flow named by a runner" "${TMP}/ok"

make_tree "${TMP}/unlaned"
printf 'appId: x\n---\n- launchApp\n' >"${TMP}/unlaned/flows/orphan.yaml"
expect_check fail "a flow no runner names" "${TMP}/unlaned"

make_tree "${TMP}/second-runner"
printf 'appId: x\n---\n- launchApp\n' >"${TMP}/second-runner/flows/beta.yaml"
printf -- '--flow "$APP_DIR/.maestro/flows/beta.yaml"\n' >>"${TMP}/second-runner/other.sh"
expect_check pass "a flow named by the second runner" "${TMP}/second-runner"

# --- the real repo ---------------------------------------------------------------

check_tree \
  "${REPO_ROOT}/apps/mobile/.maestro/flows" \
  "${REPO_ROOT}/apps/mobile/scripts/maestro-run-lane.sh" \
  "${REPO_ROOT}/apps/mobile/scripts/maestro-ios-gates.sh"
