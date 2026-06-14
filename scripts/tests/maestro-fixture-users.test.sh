#!/usr/bin/env bash

# maestro-fixture-users.test.sh — enforces the one-user-per-flow rule: every
# Maestro flow that signs in must use its OWN auth fixture user, and no two
# sign-in flows may resolve to the same fixture. The iOS lanes reuse one local
# Supabase WITHOUT reset between runs, so a shared fixture lets one flow's
# residual server state (a partial catalog, a logged workout) leak into another
# flow's pull and flake it. Self-signup is disabled, so the fixture pool is
# fixed — adding a sign-in flow means adding a fixture user.
#
# Infra-free: parses the flow files + the lane runner + the fixture constants;
# runs no app / simulator / Supabase. Part of the `meta-tests` lane (and CI).
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md
#   ("Fixture users: one per Supabase-backed flow").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FLOWS_DIR="${REPO_ROOT}/apps/mobile/.maestro/flows"
RUNNER="${REPO_ROOT}/apps/mobile/scripts/maestro-run-lane.sh"
CONSTANTS="${REPO_ROOT}/supabase/scripts/auth-fixture-constants.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

[[ -d "${FLOWS_DIR}" ]] || fail "flows dir not found: ${FLOWS_DIR}"
[[ -f "${RUNNER}" ]]    || fail "runner not found: ${RUNNER}"
[[ -f "${CONSTANTS}" ]] || fail "fixture constants not found: ${CONSTANTS}"

# var_to_user <MAESTRO_*_EMAIL>: the USER_*_EMAIL fixture the runner binds it to.
# The self-default `${VAR:-...}` on the assignment line holds the MAESTRO var,
# never a USER one, so grepping for USER_*_EMAIL isolates the real fixture.
var_to_user() {
  local var="$1"
  grep -E "(^|[^A-Z_])${var}=" "${RUNNER}" \
    | grep -oE 'USER_[A-Z0-9]+_EMAIL' \
    | sort -u
}

seen_users=""   # newline list of "USER_*_EMAIL:flowname" already claimed
signin_flows=0

for flow in "${FLOWS_DIR}"/*.yaml; do
  name="$(basename "${flow}")"

  # A flow "signs in" iff it submits the sign-in form.
  grep -q 'sign-in-submit-button' "${flow}" || continue
  signin_flows=$((signin_flows + 1))

  # The email fixture var(s) it references — must be exactly one.
  vars="$(grep -oE 'MAESTRO_[A-Z0-9_]+_EMAIL' "${flow}" | sort -u)"
  var_count="$(printf '%s\n' "${vars}" | grep -c . || true)"
  [[ "${var_count}" -eq 1 ]] \
    || fail "${name} submits sign-in but must reference exactly one MAESTRO_*_EMAIL fixture var (found ${var_count}: ${vars//$'\n'/ })"
  var="${vars}"

  # Resolve it to a concrete fixture user via the runner.
  users="$(var_to_user "${var}")"
  user_count="$(printf '%s\n' "${users}" | grep -c . || true)"
  [[ "${user_count}" -eq 1 ]] \
    || fail "${name}: ${var} must map to exactly one USER_*_EMAIL fixture in $(basename "${RUNNER}") (found ${user_count}: ${users//$'\n'/ })"
  user="${users}"

  # The fixture must actually be defined.
  grep -qE "(^|[^A-Z_])${user}=" "${CONSTANTS}" \
    || fail "${name}: fixture ${user} is not defined in $(basename "${CONSTANTS}")"

  # The core rule: no two sign-in flows share a fixture user.
  prev="$(printf '%s\n' "${seen_users}" | grep -E "^${user}:" || true)"
  [[ -z "${prev}" ]] \
    || fail "one-user-per-flow violated: ${name} and ${prev#*:} both sign in as ${user} — add a new fixture in $(basename "${CONSTANTS}")"
  seen_users="${seen_users}${user}:${name}"$'\n'
done

[[ "${signin_flows}" -ge 1 ]] || fail "found no sign-in Maestro flows — the parser likely broke"

echo "  maestro-fixture-users: ${signin_flows} sign-in flow(s), each on a unique fixture"
