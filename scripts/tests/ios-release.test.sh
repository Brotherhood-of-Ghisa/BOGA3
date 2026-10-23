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
.worktree-slot
EOF
cat > "$FIXTURE/repo/scripts/worktree-lib.sh" <<'EOF'
boga_config_root() { echo "$FIXTURE/config"; }
boga_worktree_root() { echo "$FIXTURE/worktrees"; }
boga_main_worktree_path() { echo "$FIXTURE/repo"; }
EOF
cat > "$FIXTURE/repo/boga" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'boga %s\n' "$*" >> "$FIXTURE/calls"
if [[ "$*" == 'worktree release '* ]]; then
  [[ "${FAIL_STAGE:-}" != cleanup ]] || exit 14
  target="$(cat "$FIXTURE/lease")"
  "$REAL_GIT" -C "$FIXTURE/repo" worktree remove --force "$target"
  rm "$FIXTURE/lease"
  exit
fi
while (( $# )); do
  case "$1" in --root) root="$2"; shift ;; --name) name="$2"; shift ;; --from) sha="$2"; shift ;; esac
  shift
done
"$REAL_GIT" -C "$FIXTURE/repo" worktree add --quiet --detach "$root/$name" "$sha"
[[ "${FAIL_STAGE:-}" != create-before-lease ]] || exit 13
printf '%s\n' "$root/$name" > "$FIXTURE/lease"
echo 1 > "$root/$name/.worktree-slot"
[[ "${FAIL_STAGE:-}" != create-after-lease ]] || exit 13
mkdir -p "$root/$name/supabase/.temp"
cp "$FIXTURE/repo/supabase/.env.hosted" "$root/$name/supabase/.env.hosted"
if [[ "${FAIL_STAGE:-}" == dirty ]]; then echo dirty >> "$root/$name/apps/mobile/eas.json"; fi
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
    'projects api-keys '*)
      if [[ "${FAIL_STAGE:-}" == keys ]]; then echo '[]';
      elif [[ "${LEGACY_ONLY:-}" == 1 ]]; then echo '[{"name":"service_role","api_key":"credential-must-not-leak"}]';
      else echo '[{"name":"service_role","api_key":"credential-must-not-leak"},{"name":"default","type":"publishable","api_key":"sb_publishable_wrong"},{"name":"other","type":"secret","api_key":"sb_secret_wrong"},{"name":"default","type":"secret","api_key":"sb_secret_credential-must-not-leak"}]'; fi ;;
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
cat > "$FIXTURE/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$FIXTURE/calls"
cat > "$FIXTURE/worker-request"
[[ "$*" == *'--request GET'* ]] || exit 23
[[ "${FAIL_STAGE:-}" != worker-auth ]] || exit 22
EOF
cat > "$FIXTURE/bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == fetch ]]; then
  printf 'git %s\n' "$*" >> "$FIXTURE/calls"
  [[ "${FAIL_STAGE:-}" != fetch ]] || exit 12
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
pwd -P > "$FIXTURE/job-cwd"
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
    [[ "${FAIL_STAGE:-}" != build && ! -f "$FIXTURE/fail-build" ]] || exit 9
    if [[ "${FAIL_STAGE:-}" == cancel-build ]]; then
      touch "$FIXTURE/build-entered"
      /bin/sleep 60
    fi
    while [[ "$1" != --output ]]; do shift; done
    if [[ -f "$FIXTURE/overrun" ]]; then echo 110 > "$FIXTURE/clock"; rm "$FIXTURE/overrun"; fi
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
  printf 'source_repo=%q\nrelease_parent=%q\nsha=%q\nref=%q\nprofile=%q\nproject=abcdefghijklmnopqrst\nat_epoch=0\n' \
    "$FIXTURE/repo" "$FIXTURE/worktrees" "$sha" "${2:-HEAD}" "${3:-prod}" > "$FIXTURE/$name/job.env"
  local result=0
  bash "$FIXTURE/repo/scripts/ios-release.sh" --run "$FIXTURE/$name" > "$FIXTURE/$name/log" 2>&1 || result=$?
  if [[ "${FAIL_STAGE:-}" != cleanup && -f "$FIXTURE/$name/checkout.txt" ]]; then
    [[ ! -d "$(cat "$FIXTURE/$name/checkout.txt")" && ! -f "$FIXTURE/lease" ]] || fail 'checkout or slot leaked'
  fi
  return "$result"
}

worker success || { cat "$FIXTURE/success/log"; fail 'release failed'; }
[[ "$(cat "$FIXTURE/success/status")" == 'uploaded;'* ]] || fail 'missing upload status'
[[ -f "$FIXTURE/success/app.ipa.sha256" ]] || fail 'missing IPA checksum'
[[ "$(cat "$FIXTURE/success/ipa.txt")" == *'Build: 42'* ]] || fail 'missing binary identity'
[[ "$(cat "$FIXTURE/configuration.sql")" == *notification_worker_key* ]] || fail 'worker not configured'
[[ "$(cat "$FIXTURE/configuration.sql")" == *"'sb_secret_credential-must-not-leak'"* ]] || fail 'default secret key not selected'
assert_absent 'sb_publishable_wrong|sb_secret_wrong' "$FIXTURE/configuration.sql" 'wrong worker credential selected'
[[ "$(cat "$FIXTURE/worker-request")" == *'apikey: sb_secret_credential-must-not-leak'* ]] || fail 'worker verification uses a different key'
[[ "$(cat "$FIXTURE/calls")" == *'--reveal -o json'* ]] || fail 'secret key not revealed for private configuration'
[[ "$(cat "$FIXTURE/configuration.sql")" != *'sending_enabled=true'* ]] || fail 'sending enabled'
[[ "$(cat "$FIXTURE/calls")" != *'db reset'* && "$(cat "$FIXTURE/calls")" != *'--include-seed'* ]] || fail 'destructive deployment'
[[ "$(cat "$success_file")" == "$initial_tree" ]] || fail 'successful upload did not save source tree'
[[ "$(cat "$FIXTURE/success/commit.txt")" == "$sha" ]] || fail 'release commit not recorded'
assert_absent 'git fetch' "$FIXTURE/calls" 'explicit ref was fetched'
assert_absent 'credential-must-not-leak' "$FIXTURE/success" 'credential leaked to artifacts'
node - "$FIXTURE/calls" <<'JS'
const assert = require('node:assert/strict');
const log = require('node:fs').readFileSync(process.argv[2], 'utf8');
const steps = ['eas-cli env:pull', 'supabase link', 'db push --linked --include-all --dry-run',
  'db push --linked --include-all --yes', 'functions deploy', 'db query --linked --file',
  'curl --config -', 'eas-cli build', 'eas-cli submit'];
steps.slice(1).forEach((step, i) => assert(log.indexOf(step) > log.indexOf(steps[i]), step));
assert(!/boga (test|sweep)/.test(log));
assert(log.includes('--path ' + process.argv[2].replace('/calls', '/success/app.ipa')));
JS

export LEGACY_ONLY=1
rm "$success_file"
worker legacy || { cat "$FIXTURE/legacy/log"; fail 'legacy-only release failed'; }
unset LEGACY_ONLY
[[ "$(cat "$FIXTURE/configuration.sql")" == *"'credential-must-not-leak'"* ]] || fail 'legacy fallback missing'
[[ "$(cat "$FIXTURE/worker-request")" == *'apikey: credential-must-not-leak'* ]] || fail 'legacy worker not verified'
assert_absent 'credential-must-not-leak' "$FIXTURE/legacy" 'legacy credential leaked to artifacts'

worker unchanged origin/main || fail 'unchanged release failed'
[[ "$(cat "$FIXTURE/unchanged/status")" == 'skipped;'* ]] || fail 'unchanged source not skipped'
[[ "$(cat "$FIXTURE/calls")" == 'git fetch origin +refs/heads/main:refs/remotes/origin/main' ]] || fail 'unchanged release ran deployment commands'
export FAIL_STAGE=fetch
if worker failed-fetch origin/main; then fail 'failed fetch treated as unchanged'; fi
unset FAIL_STAGE
assert_absent 'npm ci|supabase|eas-cli' "$FIXTURE/calls" 'failed fetch started release'
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit --allow-empty -qm 'same files'
empty_sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"
git -C "$FIXTURE/repo" push -q origin HEAD:main
git -C "$FIXTURE/repo" checkout -q --detach "$sha"
worker empty-commit origin/main || fail 'empty-commit release failed'
[[ "$(cat "$FIXTURE/empty-commit/status")" == 'skipped;'* ]] || fail 'empty commit rebuilt identical files'
[[ "$(cat "$FIXTURE/empty-commit/commit.txt")" == "$empty_sha" ]] || fail 'fetch did not select current main'
[[ "$(cat "$FIXTURE/calls")" == 'git fetch origin +refs/heads/main:refs/remotes/origin/main' ]] || fail 'empty commit started release'
git -C "$FIXTURE/repo" checkout -q --detach "$empty_sha"
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
for failure in create-before-lease create-after-lease; do
  export FAIL_STAGE="$failure"
  if worker "$failure"; then fail 'partial creation unexpectedly succeeded'; fi
  [[ "$(cat "$FIXTURE/$failure/status")" == 'checkout (exit 13)' ]] || fail 'creation failure masked'
  assert_absent 'npm ci|supabase|eas-cli' "$FIXTURE/calls" 'partial checkout used for release'
done
unset FAIL_STAGE
for failure in worker-auth keys; do
  export FAIL_STAGE="$failure"
  if worker "$failure"; then fail "$failure did not stop release"; fi
  [[ "$(cat "$FIXTURE/$failure/status")" == 'backend-configuration '* ]] || fail 'worker failure stage not recorded'
  assert_absent 'eas-cli build|eas-cli submit' "$FIXTURE/calls" 'release continued with broken worker authentication'
  assert_absent 'credential-must-not-leak' "$FIXTURE/$failure" 'failed verification leaked credentials'
done
unset FAIL_STAGE
export FAIL_STAGE=history
if worker history; then fail 'migration history mismatch accepted'; fi
assert_absent 'db push|functions deploy|eas-cli build' "$FIXTURE/calls" 'deployment continued after history mismatch'
unset FAIL_STAGE
touch "$FIXTURE/repo/supabase/migrations/20261017000000_duplicate.sql"
git -C "$FIXTURE/repo" add supabase/migrations/20261017000000_duplicate.sql
git -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit -qm 'duplicate migration version'
saved_sha="$sha"
sha="$(git -C "$FIXTURE/repo" rev-parse HEAD)"
if worker duplicate-migration; then fail 'duplicate migration version accepted'; fi
[[ "$(cat "$FIXTURE/duplicate-migration/log")" == *'duplicate migration version 20261017000000'* ]] || fail 'duplicate version not identified'
assert_absent 'db query|db push|functions deploy|eas-cli build|eas-cli submit' "$FIXTURE/calls" 'deployment continued with duplicate migration versions'
git -C "$FIXTURE/repo" reset -q --hard "$saved_sha"
sha="$saved_sha"
export FAIL_STAGE=dirty
if worker dirty; then fail 'dirty release source accepted'; fi
assert_absent 'npm ci|supabase|eas-cli' "$FIXTURE/calls" 'dirty release started external commands'
unset FAIL_STAGE
# The developer's working files never enter the fresh release checkout.
echo dirty >> "$FIXTURE/repo/apps/mobile/eas.json"
export FAIL_STAGE=build
if worker dirty-control; then fail 'fake build unexpectedly passed'; fi
[[ "$(cat "$FIXTURE/dirty-control/status")" == 'build '* ]] || fail 'developer edits affected release source'
unset FAIL_STAGE
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
[[ "$(cat "$success_file")" == "$(git -C "$FIXTURE/repo" rev-parse "$target_sha^{tree}")" ]] || fail 'new source baseline missing'
node - "$FIXTURE/calls" <<'JS'
const assert = require('node:assert/strict');
const log = require('node:fs').readFileSync(process.argv[2], 'utf8');
assert(log.indexOf('boga worktree create') > log.indexOf('git fetch origin +refs/heads/main:refs/remotes/origin/main'));
assert(log.indexOf('npm ci') > log.indexOf('boga worktree create'));
assert(log.indexOf('boga worktree release') > log.indexOf('eas-cli submit'));
assert(log.includes('eas-cli submit'));
JS
sha="$target_sha"
worker repeated origin/main || fail 'repeated release failed'
[[ "$(cat "$FIXTURE/calls")" == 'git fetch origin +refs/heads/main:refs/remotes/origin/main' ]] || fail 'successful source rebuilt'
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
rm "$success_file"
worker divergent origin/main || { cat "$FIXTURE/divergent/log"; fail 'local divergence blocked fresh checkout'; }
[[ "$(cat "$FIXTURE/divergent/commit.txt")" == "$target_sha" ]] || fail 'local divergent commit was released'
[[ "$(git -C "$FIXTURE/repo" rev-parse HEAD)" == "$sha" ]] || fail 'developer checkout was changed'
git -C "$FIXTURE/repo" checkout -q --detach "$target_sha"
sha="$target_sha"

git -C "$FIXTURE/repo" push -q --force origin "$initial_sha:main"
worker rewound origin/main || { cat "$FIXTURE/rewound/log"; fail 'rewritten remote blocked fresh checkout'; }
[[ "$(cat "$FIXTURE/rewound/commit.txt")" == "$initial_sha" ]] || fail 'rewritten main not selected'
git -C "$FIXTURE/repo" push -q origin HEAD:main

# Advance a fake clock to prove serial repeats, missed-slot skipping and failure stops.
cat > "$FIXTURE/bin/date" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == +%s && -f "$FIXTURE/clock" ]]; then cat "$FIXTURE/clock"; else exec /bin/date "$@"; fi
EOF
cat > "$FIXTURE/bin/sleep" <<'EOF'
#!/usr/bin/env bash
if [[ ! "$1" =~ ^[0-9]+$ || ! -f "$FIXTURE/clock" ]]; then exec /bin/sleep "$@"; fi
if [[ -f "$FIXTURE/block-sleep" ]]; then
  touch "$FIXTURE/sleep-entered"
  exec /bin/sleep 60
fi
clock="$(cat "$FIXTURE/clock")"
printf '%s\n' "$((clock + $1))" > "$FIXTURE/clock"
count=0
[[ ! -f "$FIXTURE/sleeps" ]] || count="$(cat "$FIXTURE/sleeps")"
count=$((count + 1))
printf '%s\n' "$count" > "$FIXTURE/sleeps"
if (( count == 2 )); then
  echo changed-again >> "$FIXTURE/repo/apps/mobile/release-input.txt"
  "$REAL_GIT" -C "$FIXTURE/repo" add apps/mobile/release-input.txt
  "$REAL_GIT" -C "$FIXTURE/repo" -c user.name=Test -c user.email=test@example.com commit -qm changed-again
  "$REAL_GIT" -C "$FIXTURE/repo" push -q --force origin HEAD:main
  touch "$FIXTURE/fail-build"
fi
EOF
chmod +x "$FIXTURE/bin/date" "$FIXTURE/bin/sleep"
recurring_job() {
  mkdir "$FIXTURE/$1"
  cp "$FIXTURE/repo/scripts/ios-release.sh" "$FIXTURE/$1/runner.sh"
  printf 'source_repo=%q\nrelease_parent=%q\nsha=%q\nref=origin/main\nprofile=prod\nproject=abcdefghijklmnopqrst\nat_epoch=%s\nrepeat_seconds=1\n' \
    "$FIXTURE/repo" "$FIXTURE/worktrees" "$sha" "$2" > "$FIXTURE/$1/job.env"
}
echo 100 > "$FIXTURE/clock"
touch "$FIXTURE/overrun"
rm "$success_file"
git -C "$FIXTURE/repo" checkout -q --detach "$initial_sha"
sha="$initial_sha"
: > "$FIXTURE/calls"
recurring_job recurring 100
if repeat_seconds=999 bash "$FIXTURE/recurring/runner.sh" --run "$FIXTURE/recurring" > "$FIXTURE/recurring/log" 2>&1; then
  fail 'recurring job continued after failed run'
fi
[[ "$(cat "$FIXTURE/recurring/status")" == 'stopped after failed run;'*'(exit 1)' ]] || fail 'recurring failure status missing'
[[ "$(grep -c 'npx eas-cli build' "$FIXTURE/calls")" == 2 ]] || fail 'unexpected recurring build count'
[[ "$(grep -c 'npx eas-cli submit' "$FIXTURE/calls")" == 1 ]] || fail 'recurring submission count wrong'
[[ -z "$(ls -A "$FIXTURE/worktrees")" && ! -f "$FIXTURE/lease" ]] || fail 'recurring checkout or slot leaked'
node - "$FIXTURE/recurring" <<'JS'
const fs = require('node:fs'), assert = require('node:assert/strict');
const root = process.argv[2];
const runs = fs.readdirSync(root + '/runs').map(name => root + '/runs/' + name);
assert.equal(runs.length, 3);
const statuses = runs.map(run => fs.readFileSync(run + '/status', 'utf8'));
for (const stage of ['uploaded;', 'skipped;', 'build ']) {
  assert.equal(statuses.filter(status => status.startsWith(stage)).length, 1, stage);
}
const starts = runs.map(run => Number(fs.readFileSync(run + '/job.env', 'utf8').match(/^at_epoch=(\d+)$/m)[1]));
assert.deepEqual(starts.sort((a, b) => a - b), [100, 111, 112]);
assert(runs.includes(fs.readFileSync(root + '/latest-run.txt', 'utf8').trim()));
assert(runs.every(run => fs.existsSync(run + '/release.log')));
const checkouts = runs.filter(run => fs.existsSync(run + '/checkout.txt'))
  .map(run => fs.readFileSync(run + '/checkout.txt', 'utf8').trim());
assert.equal(checkouts.length, 2);
assert.equal(new Set(checkouts).size, 2);
assert(checkouts.every(path => !fs.existsSync(path)));
JS
assert_absent 'credential-must-not-leak' "$FIXTURE/recurring" 'recurring record leaked credentials'
if bash "$FIXTURE/recurring/runner.sh" --run "$FIXTURE/recurring" >/dev/null 2>&1; then
  fail 'recurring scheduler ran twice'
fi
rm "$FIXTURE/fail-build"
git -C "$FIXTURE/repo" checkout -q --detach "$target_sha"
git -C "$FIXTURE/repo" push -q --force origin HEAD:main
sha="$target_sha"

# Cancel both a waiting job and an active build, including all child processes.
for mode in waiting build; do
  if [[ "$mode" == waiting ]]; then
    touch "$FIXTURE/block-sleep"
    marker=sleep-entered; first=200
  else
    rm "$FIXTURE/block-sleep" "$success_file"
    export FAIL_STAGE=cancel-build
    marker=build-entered; first=0
  fi
  recurring_job "cancelled-$mode" "$first"
  node - "$FIXTURE" "cancelled-$mode" "$marker" <<'JS'
const fs = require('node:fs'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const root = process.argv[2], record = root + '/' + process.argv[3], marker = root + '/' + process.argv[4];
const log = fs.openSync(record + '/log', 'a');
const child = spawn('/bin/bash', [record + '/runner.sh', '--run', record], { detached: true, stdio: ['ignore', log, log] });
fs.closeSync(log);
let finished = false;
const exit = new Promise(resolve => child.once('exit', (code, signal) => { finished = true; resolve({code, signal}); }));
(async () => {
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline && !finished) await sleep(10);
    assert(fs.existsSync(marker), 'worker did not reach cancellation stage');
    process.kill(-child.pid, 'SIGTERM');
    const result = await Promise.race([exit, sleep(5000, undefined, { ref: false }).then(() => { throw new Error('cancellation timed out'); })]);
    assert.equal(result.code, 143);
    assert(fs.readFileSync(record + '/status', 'utf8').includes('exit 143'));
    assert.equal(fs.readdirSync(record + '/runs').length, 1);
    const run = record + '/runs/' + fs.readdirSync(record + '/runs')[0];
    // Parent and child traps finish independently after a group signal.
    while (!fs.existsSync(run + '/status') && Date.now() < deadline) await sleep(10);
    assert(fs.readFileSync(run + '/status', 'utf8').includes('exit 143'));
    if (fs.existsSync(run + '/checkout.txt')) {
      assert(!fs.existsSync(fs.readFileSync(run + '/checkout.txt', 'utf8').trim()));
      assert(!fs.existsSync(root + '/lease'));
    }
  } finally {
    if (!finished) process.kill(-child.pid, 'SIGKILL');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
done
unset FAIL_STAGE
rm "$FIXTURE/clock"

# Cleanup failure must be visible and cannot turn an upload into a clean exit.
export FAIL_STAGE=cleanup
if worker cleanup; then fail 'cleanup failure was hidden'; fi
unset FAIL_STAGE
[[ "$(cat "$FIXTURE/cleanup/status")" == 'uploaded;'*'checkout cleanup failed:'*'(exit 1)' ]] || fail 'cleanup failure status missing'
[[ -d "$(cat "$FIXTURE/cleanup/checkout.txt")" && -f "$FIXTURE/lease" ]] || fail 'failed cleanup lost its checkout or lease'
"$FIXTURE/repo/boga" worktree release --slot 1 --force

for every in 1h 4h 12h 24h 48h; do
  "$FIXTURE/repo/scripts/ios-release.sh" --every "$every" --profile prod \
    --project-ref abcdefghijklmnopqrst --ref HEAD --dry-run > "$FIXTURE/plan-$every"
  [[ "$(cat "$FIXTURE/plan-$every")" == *"Repeats every $every"*'No job created.'* ]] || fail 'repeat dry-run invalid'
done
for every in daily 0h 1.5h -4h 12 999999999999999999999999999h 2400000000h; do
  if "$FIXTURE/repo/scripts/ios-release.sh" --every "$every" --profile prod \
    --project-ref abcdefghijklmnopqrst --ref HEAD --dry-run >/dev/null 2>&1; then
    fail "invalid interval accepted: $every"
  fi
done


args=(--profile prod --project-ref abcdefghijklmnopqrst --ref HEAD --dry-run)
"$FIXTURE/repo/scripts/ios-release.sh" --at 2099-10-18T01:00:00Z "${args[@]}" > "$FIXTURE/plan"
[[ "$(cat "$FIXTURE/plan")" == *'No job created.'* ]] || fail 'dry-run scheduled a job'
for at in '' 2020-01-01T01:00:00Z 2099-02-31T01:00:00Z 2099-10-18T01:00:00; do
  if "$FIXTURE/repo/scripts/ios-release.sh" --at "$at" "${args[@]}" >/dev/null 2>&1; then
    fail "invalid schedule accepted: $at"
  fi
done
"$REAL_GIT" -C "$FIXTURE/repo" worktree add --quiet --detach "$FIXTURE/launcher" "$sha"
cp "$FIXTURE/repo/supabase/.env.hosted" "$FIXTURE/launcher/supabase/.env.hosted"
"$FIXTURE/launcher/scripts/ios-release.sh" --every 12h --profile prod --project-ref abcdefghijklmnopqrst \
  > "$FIXTURE/scheduled"
"$REAL_GIT" -C "$FIXTURE/repo" worktree remove --force "$FIXTURE/launcher"
for attempt in {1..50}; do
  [[ ! -f "$FIXTURE/job-group" ]] || break
  sleep 0.02
done
record=("$FIXTURE/config/releases/"ios-*)
[[ "$(cat "$FIXTURE/job-cwd")" == "$(cd "${record[0]}" && pwd -P)" ]] || fail 'scheduler inherited removable launcher cwd'
[[ "$(cat "${record[0]}/job.env")" == *"source_repo=$FIXTURE/repo"* ]] || fail 'scheduler depends on removed launcher'
[[ "$(cat "$FIXTURE/job-group")" == "$(cat "${record[0]}/pid")" ]] || fail 'job lacks its own process group'
[[ "$(cat "${record[0]}/job.env")" == *"sha=$sha"* ]] || fail 'scheduled starting commit not recorded'
[[ "$(cat "${record[0]}/job.env")" == *'ref=origin/main'* ]] || fail 'main refresh not scheduled'
[[ "$(cat "${record[0]}/job.env")" == *'repeat_seconds=43200'* ]] || fail 'repeat interval not persisted'
cmp "$FIXTURE/repo/scripts/ios-release.sh" "${record[0]}/runner.sh" || fail 'runner not preserved'
[[ "$(cat "$FIXTURE/job-argv")" == *'--run '* ]] || fail 'worker not scheduled'
assert_absent 'credential-must-not-leak' "${record[0]}" 'schedule persisted credentials'
echo 'ios-release: fresh checkouts and cleanup, serial repeats, missed intervals, recurring failure stops/cancellation, main refresh, unchanged-source skip, successful-upload baselines, ordering, failure stops, identity, checksum, privacy, and scheduling validation passed'
