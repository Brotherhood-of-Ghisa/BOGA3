#!/usr/bin/env bash

# test-timings.sh — THE source for "how long does a test lane take".
#
# Aggregates the measured lane-run records under docs/testing/timings/records/
# (written automatically by the quality gate wrappers via lane-timing.sh) and
# prints, per lane: run count, median, min–max, the 3x-median "investigate
# above this" ceiling, and the most recent run date.
#
# Cite this output when you need to state a duration. Never estimate a lane
# time: if a lane has no records on this machine, RUN it (the gate records it)
# or use --all-machines as a rough cross-machine guide.
#
# Usage:
#   ./scripts/test-timings.sh                 # all lanes, this machine, last 90 days
#   ./scripts/test-timings.sh ios-smoke       # one lane
#   ./scripts/test-timings.sh --all-machines  # don't filter by machine fingerprint
#   ./scripts/test-timings.sh --days 30       # narrower recency window
#
# Interpretation guide (medians vs ceilings, why run 1 is slower):
# docs/testing/local-test-timings.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/lane-timing.sh"

LANE_FILTER=""
ALL_MACHINES=0
DAYS=90

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all-machines) ALL_MACHINES=1 ;;
    --days) DAYS="$2"; shift ;;
    --help|-h)
      sed -n '3,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) LANE_FILTER="$1" ;;
  esac
  shift
done

MACHINE_ID="$(boga_timing_machine_id)"
RECORDS_DIR="${REPO_ROOT}/docs/testing/timings/records"

if [[ ! -d "${RECORDS_DIR}" ]]; then
  echo "[test-timings] no records directory at ${RECORDS_DIR} — run a quality gate to record timings" >&2
  exit 1
fi

MACHINE_ID="${MACHINE_ID}" RECORDS_DIR="${RECORDS_DIR}" LANE_FILTER="${LANE_FILTER}" \
ALL_MACHINES="${ALL_MACHINES}" DAYS="${DAYS}" python3 - <<'PY'
import json, os, statistics, sys
from datetime import datetime, timedelta, timezone

records_dir = os.environ["RECORDS_DIR"]
machine_id = os.environ["MACHINE_ID"]
lane_filter = os.environ["LANE_FILTER"]
all_machines = os.environ["ALL_MACHINES"] == "1"
days = int(os.environ["DAYS"])
cutoff = datetime.now(timezone.utc) - timedelta(days=days)

def load():
    for name in sorted(os.listdir(records_dir)):
        path = os.path.join(records_dir, name)
        try:
            if name.endswith(".ndjson"):
                with open(path) as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            yield json.loads(line)
            elif name.endswith(".json"):
                with open(path) as f:
                    yield json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[test-timings] skipping unreadable record {name}: {e}", file=sys.stderr)

def recent(rec):
    try:
        ts = datetime.strptime(rec.get("recorded_at", ""), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return ts >= cutoff

all_recs = [r for r in load() if r.get("exit_code") == 0 and recent(r)]
if lane_filter:
    all_recs = [r for r in all_recs if r.get("lane") == lane_filter]

recs = all_recs if all_machines else [r for r in all_recs if r.get("machine_id") == machine_id]
note = None
if not recs and all_recs:
    recs = all_recs
    note = (f"NO records for THIS machine (id {machine_id}) in the last {days} days — showing "
            "ALL machines as a rough guide. Run the gate to record timings for this machine.")

if not recs:
    target = f"lane '{lane_filter}'" if lane_filter else "any lane"
    print(f"[test-timings] no green records for {target} in the last {days} days.")
    print("[test-timings] run the relevant quality gate — it records timings automatically.")
    sys.exit(0)

by_lane = {}
for r in recs:
    by_lane.setdefault(r["lane"], []).append(r)

def fmt(ms):
    if ms >= 60000:
        return f"{ms/60000:.1f}m"
    if ms >= 10000:
        return f"{ms/1000:.0f}s"
    return f"{ms/1000:.1f}s"

scope = "all machines" if (all_machines or note) else f"this machine ({machine_id})"
print(f"Measured lane timings — green runs only, last {days} days, {scope}")
if note:
    print(f"WARNING: {note}")
print()
print(f"{'lane':<24} {'runs':>4} {'median':>8} {'min–max':>15} {'ceiling(3x)':>12} {'last run':>10}")
for lane in sorted(by_lane):
    runs = by_lane[lane]
    ms = sorted(r["wall_ms"] for r in runs)
    med = statistics.median(ms)
    last = max(r["recorded_at"] for r in runs)[:8]
    last = f"{last[:4]}-{last[4:6]}-{last[6:8]}"
    print(f"{lane:<24} {len(ms):>4} {fmt(med):>8} {fmt(ms[0])+'–'+fmt(ms[-1]):>15} {fmt(med*3):>12} {last:>10}")
print()
print("A run above its ceiling is a SIGNAL SOMETHING IS WRONG (hang, cold/contended")
print("machine, down stack) — investigate, don't wait. Interpretation guide:")
print("docs/testing/local-test-timings.md")
PY
