#!/usr/bin/env bash

# maestro-fixture-users.test.sh — enforces the one-user-per-flow rule: every
# Maestro flow that signs in must use its OWN auth fixture user, and no two
# sign-in flows may resolve to the same fixture. The iOS lanes reuse one local
# Supabase WITHOUT reset between runs, so a shared fixture lets one flow's
# residual server state (a partial catalog, a logged workout) leak into another
# flow's pull and flake it. Self-signup is disabled, so the fixture pool is
# fixed — adding a sign-in flow means adding a fixture user.
#
# Scripted counterparties count too: a flow that drives a second user over HTTP
# (runScript) references that user through a `MAESTRO_*_COUNTERPARTY_EMAIL`
# var. Each such var must also map to exactly one defined fixture, and that
# fixture is claimed exactly like a device user — no other flow (device or
# counterparty) and not the flow's own device user may resolve to it.
#
# Infra-free: parses the flow files + the lane runner + the fixture constants;
# runs no app / simulator / Supabase. Part of the `meta-tests` lane (and CI).
# Self-tests the rule on synthetic trees first, then checks the real repo.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md
#   ("Fixture users: one per Supabase-backed flow").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# check_tree <flows-dir> <runner> <constants>: exits non-zero with a message on
# the first violation; prints a summary on success. Run it in a subshell.
check_tree() {
  local flows_dir="$1" runner="$2" constants="$3"
  [[ -d "${flows_dir}" ]] || fail "flows dir not found: ${flows_dir}"
  [[ -f "${runner}" ]]    || fail "runner not found: ${runner}"
  [[ -f "${constants}" ]] || fail "fixture constants not found: ${constants}"

  local seen_users=""   # newline list of "USER_*_EMAIL:flow (role)" already claimed
  local signin_flows=0 counterparties=0

  # resolve <var>: the one USER_*_EMAIL fixture the runner binds it to. The
  # self-default `${VAR:-...}` on an assignment line holds the MAESTRO var,
  # never a USER one, so grepping for USER_*_EMAIL isolates the real fixture.
  resolve() {
    grep -E "(^|[^A-Z_])$1=" "${runner}" \
      | grep -oE 'USER_[A-Z0-9]+_EMAIL' \
      | sort -u
  }

  # claim <flow> <role> <var>: resolve the var and claim its fixture.
  claim() {
    local name="$1" role="$2" var="$3" users user_count user prev
    users="$(resolve "${var}")"
    user_count="$(printf '%s\n' "${users}" | grep -c . || true)"
    [[ "${user_count}" -eq 1 ]] \
      || fail "${name}: ${var} must map to exactly one USER_*_EMAIL fixture in $(basename "${runner}") (found ${user_count}: ${users//$'\n'/ })"
    user="${users}"
    grep -qE "(^|[^A-Z_])${user}=" "${constants}" \
      || fail "${name}: fixture ${user} is not defined in $(basename "${constants}")"
    prev="$(printf '%s\n' "${seen_users}" | grep -E "^${user}:" || true)"
    [[ -z "${prev}" ]] \
      || fail "one-user-per-flow violated: ${name} (${role}) and ${prev#*:} both use ${user} — add a new fixture in $(basename "${constants}")"
    seen_users="${seen_users}${user}:${name} (${role})"$'\n'
  }

  local flow name all_vars device_vars var_count counterparty_vars var
  for flow in "${flows_dir}"/*.yaml; do
    name="$(basename "${flow}")"
    all_vars="$(grep -oE 'MAESTRO_[A-Z0-9_]+_EMAIL' "${flow}" | sort -u || true)"
    counterparty_vars="$(printf '%s\n' "${all_vars}" | grep -E '_COUNTERPARTY_EMAIL$' || true)"
    device_vars="$(printf '%s\n' "${all_vars}" | grep -vE '_COUNTERPARTY_EMAIL$' | grep . || true)"

    # A flow "signs in" on the device iff it submits the sign-in form.
    if grep -q 'sign-in-submit-button' "${flow}"; then
      signin_flows=$((signin_flows + 1))
      var_count="$(printf '%s\n' "${device_vars}" | grep -c . || true)"
      [[ "${var_count}" -eq 1 ]] \
        || fail "${name} submits sign-in but must reference exactly one device MAESTRO_*_EMAIL fixture var (found ${var_count}: ${device_vars//$'\n'/ })"
      claim "${name}" device "${device_vars}"
    fi

    for var in ${counterparty_vars}; do
      counterparties=$((counterparties + 1))
      claim "${name}" counterparty "${var}"
    done
  done

  [[ "${signin_flows}" -ge 1 ]] || fail "found no sign-in Maestro flows — the parser likely broke"
  echo "  maestro-fixture-users: ${signin_flows} sign-in flow(s) + ${counterparties} scripted counterpart(y/ies), each on a unique fixture"
}

# --- self-tests on synthetic trees ---------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# make_tree <dir> <runner-body>: constants define USER_A..USER_D; the flows
# are written by the caller.
make_tree() {
  mkdir -p "$1/flows"
  printf 'export USER_A_EMAIL=a\nexport USER_B_EMAIL=b\nexport USER_C_EMAIL=c\nexport USER_D_EMAIL=d\n' >"$1/constants.sh"
  printf '%s\n' "$2" >"$1/runner.sh"
}
signin_flow() { printf -- '- inputText: "${%s}"\n- tapOn:\n    id: "sign-in-submit-button"\n%s' "$1" "${2:-}"; }
counterparty_ref() { printf -- '- runScript:\n    env:\n      EMAIL: ${%s}\n' "$1"; }

expect_check() {
  local expected="$1" label="$2" dir="$3" out
  if out="$( (check_tree "${dir}/flows" "${dir}/runner.sh" "${dir}/constants.sh") 2>&1 )"; then
    [[ "${expected}" == pass ]] || fail "self-test '${label}': expected a violation, got: ${out}"
  else
    [[ "${expected}" == fail ]] || fail "self-test '${label}': expected a pass, got: ${out}"
  fi
  echo "  self-test ok (${expected}): ${label}"
}

RUNNER_OK='MAESTRO_ONE_EMAIL="$USER_A_EMAIL"
MAESTRO_TWO_EMAIL="$USER_C_EMAIL"
MAESTRO_TWO_COUNTERPARTY_EMAIL="$USER_D_EMAIL"
MAESTRO_BAD_COUNTERPARTY_EMAIL="$USER_A_EMAIL"
MAESTRO_SELF_COUNTERPARTY_EMAIL="$USER_C_EMAIL"'

make_tree "${TMP}/ok" "${RUNNER_OK}"
signin_flow MAESTRO_ONE_EMAIL >"${TMP}/ok/flows/one.yaml"
signin_flow MAESTRO_TWO_EMAIL "$(counterparty_ref MAESTRO_TWO_COUNTERPARTY_EMAIL)" >"${TMP}/ok/flows/two.yaml"
expect_check pass "device + counterparty on distinct fixtures" "${TMP}/ok"

make_tree "${TMP}/shared" "${RUNNER_OK}"
signin_flow MAESTRO_ONE_EMAIL >"${TMP}/shared/flows/one.yaml"
signin_flow MAESTRO_TWO_EMAIL "$(counterparty_ref MAESTRO_BAD_COUNTERPARTY_EMAIL)" >"${TMP}/shared/flows/two.yaml"
expect_check fail "counterparty reuses another flow's device fixture" "${TMP}/shared"

make_tree "${TMP}/self" "${RUNNER_OK}"
signin_flow MAESTRO_TWO_EMAIL "$(counterparty_ref MAESTRO_SELF_COUNTERPARTY_EMAIL)" >"${TMP}/self/flows/two.yaml"
expect_check fail "counterparty is the flow's own device user" "${TMP}/self"

make_tree "${TMP}/unmapped" "${RUNNER_OK}"
signin_flow MAESTRO_TWO_EMAIL "$(counterparty_ref MAESTRO_NOPE_COUNTERPARTY_EMAIL)" >"${TMP}/unmapped/flows/two.yaml"
expect_check fail "counterparty var bound to no fixture" "${TMP}/unmapped"

make_tree "${TMP}/two-device" "${RUNNER_OK}"
signin_flow MAESTRO_ONE_EMAIL "$(signin_flow MAESTRO_TWO_EMAIL)" >"${TMP}/two-device/flows/one.yaml"
expect_check fail "two device fixture vars in one sign-in flow" "${TMP}/two-device"

# --- the real repo ---------------------------------------------------------------

check_tree \
  "${REPO_ROOT}/apps/mobile/.maestro/flows" \
  "${REPO_ROOT}/apps/mobile/scripts/maestro-run-lane.sh" \
  "${REPO_ROOT}/supabase/scripts/auth-fixture-constants.sh"
