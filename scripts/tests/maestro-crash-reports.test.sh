#!/usr/bin/env bash
# shellcheck disable=SC2016  # assert conditions are single-quoted on purpose: eval expands them later
# maestro_collect_crash_reports against a fixture DiagnosticReports directory:
# no simulator, Xcode or slot lease needed. Guards the 2026-10-07 ios-smoke
# "flake", where the dev client crashed (SIGSEGV on a dev-client reload) and the
# run's artifacts showed only a home screen, because simulator-system.log is
# filtered to the app's own process.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck disable=SC1091
source "$SRC_ROOT/apps/mobile/scripts/maestro-ios-runtime.sh"

UDID="11111111-2222-3333-4444-555555555555"
OTHER_UDID="99999999-8888-7777-6666-555555555555"
REPORTS="$WORK/DiagnosticReports"
MARKER="$WORK/.run-started"
OUT="$WORK/crash-reports"
export MAESTRO_CRASH_REPORTS_DIR="$REPORTS"
mkdir -p "$REPORTS"

# An .ips report: a one-line JSON header, then the JSON body. Shaped like a
# real simulator report, which escapes the slashes in procPath.
write_report() {
  local file="$1" udid="$2"
  printf '%s\n' '{"app_name":"Boga3","bug_type":"309"}' > "$REPORTS/$file"
  cat >> "$REPORTS/$file" <<JSON
{
  "procPath" : "\\/Users\\/USER\\/Library\\/Developer\\/CoreSimulator\\/Devices\\/$udid\\/data\\/Containers\\/Bundle\\/Application\\/X\\/mobile-dev-client.app\\/Boga3",
  "exception": {"type": "EXC_BAD_ACCESS", "signal": "SIGSEGV"},
  "faultingThread": 1,
  "threads": [
    {"queue": "com.apple.main-thread", "frames": [{"symbol": "main"}]},
    {"name": "com.facebook.react.runtime.JavaScript", "frames": [
      {"imageIndex": 3},
      {"symbol": "facebook::react::Scheduler::uiManagerDidFinishTransaction(std::__1::shared_ptr<facebook::react::MountingCoordinator const>, bool)::\$_0::operator()() const"}
    ]}
  ]
}
JSON
}

PASS=0
assert() {
  if eval "$1"; then PASS=$((PASS + 1)); else echo "FAIL: $2" >&2; echo "--- output:" >&2; echo "$out" >&2; exit 1; fi
}
collect() {
  rm -rf "$OUT"
  rc=0
  out="$(maestro_collect_crash_reports "$@")" || rc=$?
}

# 1. Nothing crashed: silent, and no crash-reports directory.
touch "$MARKER"
collect "$UDID" Boga3 "$MARKER" "$OUT"
assert '[[ $rc == 0 && -z $out && ! -e $OUT ]]' "no reports: silent success (rc=$rc)"

# 2. Only this run's reports, from this slot's simulator, for this app.
write_report "Boga3-old.ips" "$UDID"
touch -t 202601010000 "$REPORTS/Boga3-old.ips"
touch -t 202601010001 "$MARKER"
write_report "Boga3-this-run.ips" "$UDID"
write_report "Boga3-other-slot.ips" "$OTHER_UDID"
# Another slot's report that mentions this slot's UDID outside procPath.
sed "s/\"faultingThread\"/\"incident\": \"$UDID\", \"faultingThread\"/" "$REPORTS/Boga3-other-slot.ips" > "$WORK/other-slot.ips"
mv "$WORK/other-slot.ips" "$REPORTS/Boga3-other-slot.ips"
write_report "Other-this-run.ips" "$UDID"
collect "$UDID" Boga3 "$MARKER" "$OUT"
assert '[[ $rc == 0 ]]' "collection succeeds (rc=$rc)"
assert '[[ -f $OUT/Boga3-this-run.ips ]]' "this run's report is copied into the artifacts"
assert '[[ $(ls "$OUT" | wc -l | tr -d " ") == 1 ]]' "only this run's report is copied: $(ls "$OUT" | tr "\n" " ")"
assert '[[ $(grep CRASHED <<<"$out") == "[maestro] dev client CRASHED during this run: SIGSEGV on thread com.facebook.react.runtime.JavaScript in facebook::react::Scheduler::uiManagerDidFinishTransaction" ]]' "the crash is named by signal, thread and top symbol, without its signature"
assert '[[ $out == *"crash report: $OUT/Boga3-this-run.ips"* ]]' "the copied report's path is printed"
assert '[[ $(grep -c CRASHED <<<"$out") == 1 ]]' "another slot's, an older and another app's report are not reported"

# 3. A report that does not parse is still copied and named.
printf 'not json\n%s\n' "\\/Devices\\/$UDID\\/" > "$REPORTS/Boga3-garbled.ips"
collect "$UDID" Boga3 "$MARKER" "$OUT"
assert '[[ $rc == 0 && -f $OUT/Boga3-garbled.ips ]]' "an unparsable report is still copied (rc=$rc)"
assert '[[ $out == *"unreadable report Boga3-garbled.ips"* ]]' "an unparsable report is named as unreadable"

# 4. Missing inputs never fail the run: collection only reports.
collect "$UDID" Boga3 "$WORK/no-marker" "$OUT"
assert '[[ $rc == 0 && -z $out ]]' "a missing start marker collects nothing (rc=$rc)"
collect "$UDID" "" "$MARKER" "$OUT"
assert '[[ $rc == 0 && -z $out ]]' "an unknown executable collects nothing (rc=$rc)"
MAESTRO_CRASH_REPORTS_DIR="$WORK/absent" collect "$UDID" Boga3 "$MARKER" "$OUT"
assert '[[ $rc == 0 && -z $out ]]' "a missing reports directory collects nothing (rc=$rc)"

echo "maestro-crash-reports.test.sh: ${PASS} assertions passed"
