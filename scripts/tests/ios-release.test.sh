#!/usr/bin/env bash

# Hermetic release orchestration: fake CLIs, no releases, hosted writes, or Apple calls.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT
export FIXTURE
export REAL_GIT="$(command -v git)"
fail() { echo "ASSERT FAILED: $*" >&2; exit 1; }
assert_absent() {
  local result=0
  grep -EqR -- "$1" "$2" || result=$?
  [[ "$result" == 1 ]] || fail "$3 (grep exit $result)"
}
if (assert_absent 'set -euo pipefail' "${BASH_SOURCE[0]}" 'match') >/dev/null 2>&1; then
  fail 'absence assertion accepted a match'
fi
if (assert_absent 'anything' "$FIXTURE/missing" 'read failure') >/dev/null 2>&1; then
  fail 'absence assertion hid a search error'
fi
mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/scripts" "$FIXTURE/repo/apps/mobile" \
  "$FIXTURE/repo/supabase/scripts" "$FIXTURE/repo/supabase/migrations" \
  "$FIXTURE/repo/supabase/functions/notification-worker" "$FIXTURE/repo/supabase/.temp"
cp "$REPO_ROOT/scripts/ios-release.sh" "$FIXTURE/repo/scripts/"
cp "$REPO_ROOT/apps/mobile/eas.json" "$FIXTURE/repo/apps/mobile/"
touch "$FIXTURE/repo/supabase/migrations/20261017000000_test.sql" \
  "$FIXTURE/repo/supabase/functions/notification-worker/index.ts"
cat > "$FIXTURE/repo/.gitignore" <<'EOF'
supabase/.env.hosted
supabase/.temp/
apps/mobile/.env.local
EOF
cat > "$FIXTURE/repo/scripts/worktree-lib.sh" <<'EOF'
boga_config_root() { echo "$FIXTURE/config"; }
boga_worktree_root() { echo "$FIXTURE/worktrees"; }
EOF
cat > "$FIXTURE/repo/boga" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == 'worktree start' ]]; then
  echo 'boga worktree start' >> "$FIXTURE/calls"
  exit
fi
while (( $# )); do
  case "$1" in --root) root="$2"; shift ;; --name) name="$2"; shift ;; esac
  shift
done
mkdir -p "$root/$name"
EOF
chmod +x "$FIXTURE/repo/boga"
cat > "$FIXTURE/repo/supabase/.env.hosted" <<'EOF'
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_ACCESS_TOKEN=credential-must-not-leak
SUPABASE_DB_PASSWORD=credential-must-not-leak
EOF
cat > "$FIXTURE/repo/supabase/scripts/_common.sh" <<'EOF'
run_supabase() {
  printf 'supabase %s\n' "$*" >> "$FIXTURE/calls"
  case "$*" in
    'link '*) echo abcdefghijklmnopqrst > supabase/.temp/project-ref ;;
    'projects api-keys '*) echo '[{"name":"service_role","api_key":"credential-must-not-leak"}]' ;;
    'db push --linked --include-all --yes') [[ "${FAIL_STAGE:-}" != migrations ]] || return 7 ;;
    'db query --linked do '*) [[ "${FAIL_STAGE:-}" != history ]] || return 11 ;;
    'functions deploy '*) [[ "${FAIL_STAGE:-}" != functions ]] || return 8 ;;
    'db query --linked --file '*) cp "$5" "$FIXTURE/configuration.sql" ;;
  esac
}
EOF
cat > "$FIXTURE/bin/npm" <<'EOF'
#!/usr/bin/env bash
echo 'npm ci' >> "$FIXTURE/calls"
EOF
cat > "$FIXTURE/bin/docker" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == info ]]
EOF
cat > "$FIXTURE/bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == pull ]]; then
  printf 'git %s\n' "$*" >> "$FIXTURE/calls"
  [[ "${FAIL_STAGE:-}" != pull ]] || exit 12
fi
exec "$REAL_GIT" "$@"
EOF
cat > "$FIXTURE/bin/uname" <<'EOF'
#!/usr/bin/env bash
echo Darwin
EOF
cat > "$FIXTURE/bin/caffeinate" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$FIXTURE/job-argv"
ps -o pgid= -p "$$" | tr -d ' ' > "$FIXTURE/job-group.tmp"
mv "$FIXTURE/job-group.tmp" "$FIXTURE/job-group"
EOF
cat > "$FIXTURE/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'npx %s\n' "$*" >> "$FIXTURE/calls"
case "$*" in
  'eas-cli env:pull '*)
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\nEXPO_PUBLIC_SUPABASE_ANON_KEY=public-key\n' \
      "${FAKE_URL:-https://abcdefghijklmnopqrst.supabase.co}" > .env.local ;;
  'expo config --json') echo '{"version":"2.1.0","extra":{"releaseCodename":"Test","eas":{"projectId":"3c00cd23-0946-4eb6-bbf0-4542879cd314"}}}' ;;
  'eas-cli build '*)
    [[ "${FAIL_STAGE:-}" != build ]] || exit 9
    while [[ "$1" != --output ]]; do shift; done
    printf 'fake IPA\n' > "$2" ;;
  'eas-cli submit '*) [[ "${FAIL_STAGE:-}" != submission ]] || exit 10 ;;
  *) exit 99 ;;
esac
EOF
cat > "$FIXTURE/bin/unzip" <<'EOF'
#!/usr/bin/env bash
mkdir -p "$4/Payload/BoGa.app"
touch "$4/Payload/BoGa.app/Info.plist"
EOF
cat > "$FIXTURE/bin/plutil" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  CFBundleIdentifier) echo "${FAKE_BUNDLE:-com.phano.boga3}" ;;
  CFBundleShortVersionString) echo '2.1.0' ;;
  CFBundleVersion) echo '42' ;;
esac
EOF
chmod +x "$FIXTURE/bin/"*
export PATH="$FIXTURE/bin:$PATH"
git -C "$FIXTURE/repo" init -q -b main
git -C "$FIXTURE/repo" add .
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit -qm fixture
git init --bare -q "$FIXTURE/origin.git"
git -C "$FIXTURE/repo" remote add origin "$FIXTURE/origin.git"
git -C "$FIXTURE/repo" push -q origin HEAD:main
git -C "$FIXTURE/repo" checkout -q --detach
sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"
initial_sha="$sha"
initial_tree="$(git -C "$FIXTURE/repo" rev-parse 'HEAD^{tree}')"
success_file="$FIXTURE/config/releases/last-uploaded-abcdefghijklmnopqrst-prod.tree"

worker() {
  local name="$1"
  mkdir "$FIXTURE/$name"
  : > "$FIXTURE/calls"
  printf 'release_root=%q\nsha=%q\nref=%q\nprofile=%q\nproject=abcdefghijklmnopqrst\nat_epoch=0\n' \
    "$FIXTURE/repo" "$sha" "${2:-HEAD}" "${3:-prod}" > "$FIXTURE/$name/job.env"
  bash "$FIXTURE/repo/scripts/ios-release.sh" --run "$FIXTURE/$name" > "$FIXTURE/$name/log" 2>&1
}

worker success || { cat "$FIXTURE/success/log"; fail 'release failed'; }
[[ "$(cat "$FIXTURE/success/status")" == 'uploaded;'* ]] || fail 'missing upload status'
[[ -f "$FIXTURE/success/app.ipa.sha256" ]] || fail 'missing IPA checksum'
[[ "$(cat "$FIXTURE/success/ipa.txt")" == *'Build: 42'* ]] || fail 'missing binary identity'
[[ "$(cat "$FIXTURE/configuration.sql")" == *notification_worker_key* ]] || fail 'worker not configured'
[[ "$(cat "$FIXTURE/configuration.sql")" != *'sending_enabled=true'* ]] || fail 'sending enabled'
[[ "$(cat "$FIXTURE/calls")" != *'db reset'* && "$(cat "$FIXTURE/calls")" != *'--include-seed'* ]] || fail 'destructive deployment'
[[ "$(cat "$success_file")" == "$initial_tree" ]] || fail 'successful upload did not save source tree'
[[ "$(cat "$FIXTURE/success/commit.txt")" == "$sha" ]] || fail 'release commit not recorded'
assert_absent 'git pull' "$FIXTURE/calls" 'explicit ref was pulled'
assert_absent 'credential-must-not-leak' "$FIXTURE/success" 'credential leaked to artifacts'
node - "$FIXTURE/calls" <<'JS'
const assert = require('node:assert/strict');
const log = require('node:fs').readFileSync(process.argv[2], 'utf8');
const steps = ['eas-cli env:pull', 'supabase link', 'db push --linked --include-all --dry-run',
  'db push --linked --include-all --yes', 'functions deploy', 'db query --linked --file',
  'eas-cli build', 'eas-cli submit'];
steps.slice(1).forEach((step, i) => assert(log.indexOf(step) > log.indexOf(steps[i]), step));
assert(!/boga (test|sweep)/.test(log));
assert(log.includes('--path ' + process.argv[2].replace('/calls', '/success/app.ipa')));
JS

worker unchanged origin/main || fail 'unchanged release failed'
[[ "$(cat "$FIXTURE/unchanged/status")" == 'skipped;'* ]] || fail 'unchanged source not skipped'
[[ "$(cat "$FIXTURE/calls")" == 'git pull --ff-only origin main' ]] || fail 'unchanged release ran deployment commands'
export FAIL_STAGE=pull
if worker failed-pull origin/main; then fail 'failed pull treated as unchanged'; fi
unset FAIL_STAGE
assert_absent 'npm ci|supabase|eas-cli' "$FIXTURE/calls" 'failed pull started release'
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit --allow-empty -qm 'same files'
empty_sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"
git -C "$FIXTURE/repo" push -q origin HEAD:main
git -C "$FIXTURE/repo" checkout -q --detach "$sha"
worker empty-commit origin/main || fail 'empty-commit release failed'
[[ "$(cat "$FIXTURE/empty-commit/status")" == 'skipped;'* ]] || fail 'empty commit rebuilt identical files'
[[ "$(cat "$FIXTURE/empty-commit/commit.txt")" == "$empty_sha" ]] || fail 'pull did not advance checkout'
[[ "$(cat "$FIXTURE/calls")" == 'git pull --ff-only origin main' ]] || fail 'empty commit started release'
echo 'new source' > "$FIXTURE/repo/apps/mobile/release-input.txt"
git -C "$FIXTURE/repo" add apps/mobile/release-input.txt
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit -qm 'changed files'
sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"

for failure in migrations functions build submission; do
  export FAIL_STAGE="$failure"
  if worker "$failure"; then fail "$failure did not stop release"; fi
  [[ "$(cat "$FIXTURE/$failure/status")" == "$failure "* ]] || fail 'failure stage not recorded'
  [[ "$(cat "$success_file")" == "$initial_tree" ]] || fail 'failed release advanced successful source tree'
  if [[ "$failure" != submission ]]; then
    assert_absent 'eas-cli submit' "$FIXTURE/calls" 'submission continued after failure'
  fi
done
unset FAIL_STAGE
export FAIL_STAGE=history
if worker history; then fail 'migration history mismatch accepted'; fi
assert_absent 'db push|functions deploy|eas-cli build' "$FIXTURE/calls" 'deployment continued after history mismatch'
unset FAIL_STAGE
echo dirty >> "$FIXTURE/repo/apps/mobile/eas.json"
if worker dirty origin/main; then fail 'dirty release source accepted'; fi
[[ ! -s "$FIXTURE/calls" ]] || fail 'dirty release started external commands'
git -C "$FIXTURE/repo" checkout -- apps/mobile/eas.json
export FAKE_URL=https://different-project.supabase.co
if worker mismatch; then fail 'backend mismatch accepted'; fi
assert_absent 'supabase link|db push|eas-cli build' "$FIXTURE/calls" 'side effects after identity mismatch'
unset FAKE_URL
export FAKE_BUNDLE=com.wrong.app
if worker wrong-ipa; then fail 'wrong IPA accepted'; fi
assert_absent 'eas-cli submit' "$FIXTURE/calls" 'wrong IPA submitted'
unset FAKE_BUNDLE
if bash "$FIXTURE/repo/scripts/ios-release.sh" --run "$FIXTURE/success" >/dev/null 2>&1; then
  fail 'job ran twice'
fi

git -C "$FIXTURE/repo" push -q origin HEAD:main
target_sha="$sha"
git -C "$FIXTURE/repo" checkout -q --detach "$initial_sha"
sha="$initial_sha"
worker refreshed origin/main || { cat "$FIXTURE/refreshed/log"; fail 'refreshed release failed'; }
[[ "$(cat "$FIXTURE/refreshed/commit.txt")" == "$target_sha" ]] || fail 'new main was not released'
[[ "$(cat "$success_file")" == "$(git -C "$FIXTURE/repo" rev-parse 'HEAD^{tree}')" ]] || fail 'new source baseline missing'
node - "$FIXTURE/calls" <<'JS'
const assert = require('node:assert/strict');
const log = require('node:fs').readFileSync(process.argv[2], 'utf8');
assert(log.indexOf('boga worktree start') > log.indexOf('git pull --ff-only origin main'));
assert(log.indexOf('npm ci') > log.indexOf('boga worktree start'));
assert(log.includes('eas-cli submit'));
JS
sha="$target_sha"
worker repeated origin/main || fail 'repeated release failed'
[[ "$(cat "$FIXTURE/calls")" == 'git pull --ff-only origin main' ]] || fail 'successful source rebuilt'
export FAKE_BUNDLE=com.phano.boga3.dev
worker preview HEAD preview || { cat "$FIXTURE/preview/log"; fail 'profile-specific first release failed'; }
unset FAKE_BUNDLE
[[ "$(cat "$FIXTURE/preview/status")" == 'uploaded;'* ]] || fail 'prod baseline skipped preview'
[[ -f "$FIXTURE/config/releases/last-uploaded-abcdefghijklmnopqrst-preview.tree" ]] || fail 'preview baseline missing'
git -C "$FIXTURE/repo" checkout -q --detach "$initial_sha"
echo divergent > "$FIXTURE/repo/divergent.txt"
git -C "$FIXTURE/repo" add divergent.txt
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit -qm divergent
sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"
if worker divergent origin/main; then fail 'divergent pull accepted'; fi
assert_absent 'boga worktree start|npm ci|supabase|eas-cli' "$FIXTURE/calls" 'divergent pull started release'
git -C "$FIXTURE/repo" checkout -q --detach "$target_sha"
sha="$target_sha"

git -C "$FIXTURE/repo" push -q --force origin "$initial_sha:main"
if worker rewound origin/main; then fail 'rewound main accepted'; fi
assert_absent 'boga worktree start|npm ci|supabase|eas-cli' "$FIXTURE/calls" 'rewound main started release'
git -C "$FIXTURE/repo" push -q origin HEAD:main

args=(--profile prod --project-ref abcdefghijklmnopqrst --ref HEAD --dry-run)
"$FIXTURE/repo/scripts/ios-release.sh" --at 2099-10-18T01:00:00Z "${args[@]}" > "$FIXTURE/plan"
[[ "$(cat "$FIXTURE/plan")" == *'No job created.'* ]] || fail 'dry-run scheduled a job'
for at in '' 2020-01-01T01:00:00Z 2099-02-31T01:00:00Z 2099-10-18T01:00:00; do
  if "$FIXTURE/repo/scripts/ios-release.sh" --at "$at" "${args[@]}" >/dev/null 2>&1; then
    fail "invalid schedule accepted: $at"
  fi
done
"$FIXTURE/repo/scripts/ios-release.sh" --at now --profile prod --project-ref abcdefghijklmnopqrst \
  > "$FIXTURE/scheduled"
for attempt in {1..50}; do
  [[ ! -f "$FIXTURE/job-group" ]] || break
  sleep 0.02
done
record=("$FIXTURE/config/releases/"ios-*)
[[ "$(cat "$FIXTURE/job-group")" == "$(cat "${record[0]}/pid")" ]] || fail 'job lacks its own process group'
[[ "$(cat "${record[0]}/job.env")" == *"sha=$sha"* ]] || fail 'scheduled starting commit not recorded'
[[ "$(cat "${record[0]}/job.env")" == *'ref=origin/main'* ]] || fail 'main refresh not scheduled'
cmp "$FIXTURE/repo/scripts/ios-release.sh" "${record[0]}/runner.sh" || fail 'runner not preserved'
[[ "$(cat "$FIXTURE/job-argv")" == *'--run '* ]] || fail 'worker not scheduled'
assert_absent 'credential-must-not-leak' "${record[0]}" 'schedule persisted credentials'
echo 'ios-release: main refresh, unchanged-source skip, successful-upload baselines, ordering, failure stops, identity, checksum, privacy, and scheduling validation passed'
