#!/usr/bin/env bash

# Tests for scripts/test-for.sh (trigger matcher). Infra-free: explicit paths
# only, no git diff.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF="${REPO_ROOT}/scripts/test-for.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# requires <expected-lane> <paths...>: asserts the lane is in the union.
requires() {
  local lane="$1"; shift
  "${TF}" --tsv "$@" | cut -f1 | grep -qx "${lane}" \
    || fail "expected '${lane}' required for: $* — got: [$("${TF}" --tsv "$@" | cut -f1 | tr '\n' ' ')]"
}
not_requires() {
  local lane="$1"; shift
  if "${TF}" --tsv "$@" | cut -f1 | grep -qx "${lane}"; then
    fail "did NOT expect '${lane}' required for: $*"
  fi
}

# sync runtime → fast + backend + ios-sync-e2e, not frontend
requires fast          apps/mobile/src/sync/scheduler.ts
requires backend       apps/mobile/src/sync/scheduler.ts
requires ios-sync-e2e  apps/mobile/src/sync/scheduler.ts
not_requires frontend  apps/mobile/src/sync/scheduler.ts

# auth wiring behaves like sync
requires ios-sync-e2e  apps/mobile/src/auth/service.ts

# UI → fast + frontend-ui (backend-free iOS lanes), not the full frontend,
# not backend, not the Supabase-backed e2e lanes
requires fast              apps/mobile/components/Button.tsx
requires frontend-ui       apps/mobile/components/Button.tsx
not_requires frontend      apps/mobile/components/Button.tsx
not_requires backend       apps/mobile/components/Button.tsx
not_requires ios-sync-e2e  apps/mobile/components/Button.tsx

# jest suites under app/__tests__ → fast only (no simulator)
requires fast              apps/mobile/app/__tests__/ui-icon.test.tsx
not_requires frontend-ui   apps/mobile/app/__tests__/ui-icon.test.tsx
not_requires frontend      apps/mobile/app/__tests__/ui-icon.test.tsx
requires backend           apps/mobile/app/__tests__/sync/pull.test.ts
not_requires frontend-ui   apps/mobile/app/__tests__/sync/pull.test.ts

# root layout / harness → the full frontend gate (frontend-ui folded into it)
requires frontend          apps/mobile/app/_layout.tsx
not_requires frontend-ui   apps/mobile/app/_layout.tsx
requires frontend          apps/mobile/app/maestro-harness.tsx
requires frontend          apps/mobile/app/_layout.tsx apps/mobile/components/Button.tsx
not_requires frontend-ui   apps/mobile/app/_layout.tsx apps/mobile/components/Button.tsx

# e2e screens → their own e2e lane on top of the UI tier
requires ios-auth-profile  apps/mobile/app/sign-in.tsx
requires frontend-ui       apps/mobile/app/sign-in.tsx
requires ios-sync-e2e      apps/mobile/components/sync-status/sync-status-panel.tsx

# group screens → launch smoke + groups e2e only; a removal is per path, so a
# component in the same change still brings the UI tier
requires ios-groups-e2e    apps/mobile/app/group/join.tsx
requires ios-smoke         apps/mobile/app/group/join.tsx
not_requires frontend-ui   apps/mobile/app/group/join.tsx
requires ios-groups-e2e    "apps/mobile/app/(tabs)/groups.tsx"
not_requires frontend-ui   apps/mobile/components/groups/stream-row.tsx
requires frontend-ui       apps/mobile/app/group/join.tsx apps/mobile/components/Button.tsx

# server schema → backend only (no mobile gates)
requires backend       supabase/migrations/20990101_x.sql
not_requires fast      supabase/migrations/20990101_x.sql
not_requires frontend  supabase/migrations/20990101_x.sql

# docs → docs-check only
requires docs-check    docs/specs/05-data-model.md
not_requires fast      docs/specs/05-data-model.md

# meta-tooling → meta-tests
requires meta-tests    scripts/pr-check.sh
requires meta-tests    scripts/tests/fixtures/pr-bodies/good.md

# Maestro runner / config → frontend + meta-tests (the fixture-user rule guard);
# a single flow → only the lane that runs it (+ meta-tests)
requires frontend      apps/mobile/scripts/maestro-run-lane.sh
requires meta-tests    apps/mobile/scripts/maestro-run-lane.sh
requires frontend      apps/mobile/.maestro/maestro.env.sample
requires ios-smoke     apps/mobile/.maestro/flows/smoke-launch.yaml
requires meta-tests    apps/mobile/.maestro/flows/smoke-launch.yaml
not_requires frontend  apps/mobile/.maestro/flows/smoke-launch.yaml
# an unlisted (new) flow falls back to the full gate
requires frontend      apps/mobile/.maestro/flows/brand-new-flow.yaml

# union across files
requires backend       apps/mobile/components/Button.tsx supabase/tests/x.sh
requires frontend-ui   apps/mobile/components/Button.tsx supabase/tests/x.sh

# unmatched path → no requirements, exit 0
out="$("${TF}" --tsv some/random/file.xyz)"
[[ -z "${out}" ]] || fail "expected no requirements for unmatched path, got: ${out}"

# Advisory sweep hint: shown for shared UI chrome or 15+ UI files, never in
# --tsv (so pr-check can't turn it into a requirement), not for one screen.
"${TF}" apps/mobile/components/ui/card.tsx | grep -q 'boga sweep' \
  || fail "expected a sweep recommendation for a components/ui change"
many=(); for i in $(seq 1 15); do many+=("apps/mobile/components/session-view/f${i}.tsx"); done
"${TF}" "${many[@]}" | grep -q 'boga sweep' || fail "expected a sweep recommendation for 15 UI files"
if "${TF}" --tsv apps/mobile/components/ui/card.tsx | grep -q sweep; then
  fail "the sweep recommendation must not appear in --tsv output"
fi
if "${TF}" apps/mobile/components/session-view/x.tsx | grep -q 'boga sweep'; then
  fail "did not expect a sweep recommendation for one screen component"
fi

# Registry integrity: every requirement names a real lane or gate alias, and
# every committed flow's row names the lane whose runner arm runs that flow
# (so moving a flow between lanes can't leave its trigger pointing at the old one).
REPO_ROOT="${REPO_ROOT}" TF="${TF}" python3 - <<'PYCHECK'
import os, re, subprocess, sys
root = os.environ["REPO_ROOT"]
def rows(path, n):
    for line in open(os.path.join(root, path)):
        parts = line.rstrip("\n").split("\t")
        if line.strip() and not line.lstrip().startswith("#") and len(parts) == n:
            yield parts
lanes = {r[0]: r for r in rows("scripts/lanes.tsv", 6)}
known = set(lanes) | {"fast", "backend", "frontend", "frontend-ui"}
bad = [(pat, tok) for pat, reqs, _ in rows("scripts/triggers.tsv", 3)
       for tok in reqs.split(",") if tok.strip().lstrip("-") not in known]
if bad:
    sys.exit(f"  ASSERT FAILED: triggers.tsv names unknown lanes/gates: {bad}")

arm_lane = {}
for name, r in lanes.items():
    m = re.search(r"maestro-run-lane\.sh (\S+)$", r[5])
    if m:
        arm_lane[m.group(1)] = name
flow_lane, arm = {}, None
for line in open(os.path.join(root, "apps/mobile/scripts/maestro-run-lane.sh")):
    m = re.match(r"^  ([a-z0-9-]+)\)\s*$", line)
    if m:
        arm = m.group(1)
    for flow in re.findall(r"([A-Za-z0-9_-]+\.yaml)", line):
        if arm in arm_lane:
            flow_lane[flow] = arm_lane[arm]
flows_dir = os.path.join(root, "apps/mobile/.maestro/flows")
for flow in sorted(os.listdir(flows_dir)):
    if not flow.endswith(".yaml"):
        continue
    want = flow_lane.get(flow)
    if not want:
        sys.exit(f"  ASSERT FAILED: {flow} is not run by any maestro-run-lane.sh arm")
    out = subprocess.run([os.environ["TF"], "--tsv", f"apps/mobile/.maestro/flows/{flow}"],
                         capture_output=True, text=True, check=True).stdout
    got = {l.split("\t")[0] for l in out.splitlines() if l}
    if got != {want, "meta-tests"}:
        sys.exit(f"  ASSERT FAILED: {flow} should require exactly {{{want}, meta-tests}} "
                 f"(add/fix its row in scripts/triggers.tsv); got {sorted(got)}")
print(f"  test-for: registry names only real lanes; {len(flow_lane)} flow rows match their runner arms")
PYCHECK

echo "  test-for: all assertions passed"
