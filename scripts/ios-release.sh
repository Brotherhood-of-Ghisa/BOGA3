#!/usr/bin/env bash

# Local release scheduling; no test lanes or sweep. See --help before scheduling.
set -euo pipefail
umask 077

fail() { echo "[ios-release] $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./boga ios release [--at <UTC time|now>] [--every <hours>h]
                        --profile <preview|prod> --project-ref <Supabase ref>
                        [--ref <git ref>] [--dry-run]

Example: ./boga ios release --at 2026-10-18T01:00:00Z --profile prod \
           --project-ref <your-project-ref>

Creates a detached release worktree and a background job on this Mac. At run time,
the default origin/main is pulled with --ff-only; other --ref values stay pinned.
If the tracked tree matches this Mac's last successful upload for the same profile
and backend, skip the release. Otherwise:
  1. Pin the source, install mobile dependencies, and check the EAS/backend identity.
  2. Apply migrations without seeds/reset; deploy every checked-in Edge Function.
  3. Configure group evaluation and notification invocation/registration; verify the worker.
  4. Build locally, inspect/checksum the IPA, and submit that IPA to Apple.

Without --every, --at is required and schedules one run. --every accepts any positive
whole number of hours (e.g. 1h, 4h, 12h, 24h, 48h), starting now unless --at sets
the first run. It reuses one checkout, retains a separate record per run, and stops
on any failure. Extra missed intervals are skipped. Repetition stops on
cancellation, logout or reboot.

No gates, sweep, metadata changes, Git tags, or automatic retries after failure.
Docker must be running for function bundling. Hosted credentials come from
supabase/.env.hosted (the shared machine config):
SUPABASE_PROJECT_REF, SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD.
EAS login/signing/submission credentials must already work non-interactively.
The selected EAS environment must contain readable
EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY values.

The job prints its PID, checkout, and persistent log/artifact directory. Cancel
with kill -TERM -- -<PID> (the entire job process group). It keeps the checkout
on success/failure for inspection; run ./boga worktree release --force there
after finishing with its external artifacts.
The Mac must stay powered on, logged in, lid open, and able to access signing keys.
The background job does not survive logout/reboot. No Render/consent-site
deployments or hosted device tests. New notification config has sending disabled;
existing configuration must match the selected app and keeps its sending setting.
EOF
}

load_hosted_env() {
  [[ -f supabase/.env.hosted ]] || fail 'missing supabase/.env.hosted'
  set -a
  source supabase/.env.hosted
  set +a
  [[ "${SUPABASE_PROJECT_REF:-}" == "$project" && "${SUPABASE_URL:-}" == "https://${project}.supabase.co" ]] \
    || fail 'hosted configuration does not match --project-ref'
  [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_DB_PASSWORD:-}" ]] \
    || fail 'hosted access token and database password are required'
  # An inherited dev-stack override must never redirect hosted operations.
  unset BOGA_SUPABASE_WORKDIR SUPABASE_WORKDIR
}

assert_source() {
  local current_sha state
  current_sha="$(git rev-parse HEAD)"
  state="$(git status --porcelain)"
  [[ "$current_sha" == "$sha" && -z "$state" ]] \
    || fail 'release checkout changed unexpectedly'
}

check_migrations() {
  local phase="$1" versions='' file version
  for file in supabase/migrations/*.sql; do
    version="${file##*/}"; version="${version%%_*}"
    [[ "$version" =~ ^[0-9]{14}$ ]] || fail "invalid migration filename: $file"
    versions+="${versions:+,}('$version')"
  done
  # Refuse remote-only history before writing; require exact history afterwards.
  local difference="select version from supabase_migrations.schema_migrations except select * from (values $versions) as expected(version)"
  if [[ "$phase" == after ]]; then
    difference="($difference) union all (select * from (values $versions) as expected(version) except select version from supabase_migrations.schema_migrations)"
  fi
  run_supabase db query --linked "do \$\$ begin if exists ($difference) then raise exception 'Release migration history mismatch'; end if; end \$\$;"
}

configure_backend() (
  local config_sql
  config_sql="$(mktemp)"
  trap 'rm -f "$config_sql"' EXIT
  # Match the runtime's default secret key; legacy keys remain usable on older projects.
  if [[ -f supabase/functions/notification-worker/index.ts ]]; then
    BOGA_NOTIFICATION_WORKER_KEY="$(run_supabase projects api-keys --project-ref "$project" --reveal -o json \
      | jq -er '([.[] | select(.name == "default" and .type == "secret") | .api_key][0]
        // [.[] | select(.name == "service_role") | .api_key][0]) | select(type == "string" and length > 0)')"
    export BOGA_NOTIFICATION_WORKER_KEY
  fi
  node - "$project" "$profile" "$bundle" "$record/identity.json" > "$config_sql" <<'JS'
const fs = require('node:fs');
const [project, profile, bundle, identityFile] = process.argv.slice(2);
const projectId = JSON.parse(fs.readFileSync(identityFile)).projectId;
if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Missing EAS project UUID');
const q = value => "'" + value.replaceAll("'", "''") + "'";
const environment = profile === 'prod' ? 'production' : 'preview';
const url = `https://${project}.supabase.co/functions/v1/`;
console.log('begin;');
if (fs.existsSync('supabase/functions/notification-worker/index.ts')) {
console.log(`
insert into app_public.notification_config(environment,project_id,bundle_id,provider)
values (${q(environment)},${q(projectId)},${q(bundle)},'expo') on conflict do nothing;
do $$ begin
  if not exists(select 1 from app_public.notification_config where singleton
    and environment=${q(environment)} and project_id=${q(projectId)} and bundle_id=${q(bundle)})
  then raise exception 'Notification environment conflicts with release'; end if;
end $$;`);
for (const [name, value] of Object.entries({
  notification_worker_url: url + 'notification-worker',
  notification_worker_key: process.env.BOGA_NOTIFICATION_WORKER_KEY,
})) {
  console.log(`do $$ declare secret_id uuid; begin
    select id into secret_id from vault.secrets where name=${q(name)} order by created_at desc limit 1;
    if secret_id is null then perform vault.create_secret(${q(value)},${q(name)});
    else perform vault.update_secret(secret_id,${q(value)}); end if;
  end $$;`);
}
}
console.log(`select app_public.group_eval_set_url(${q(url + 'group-eval')});`);
console.log('commit;');
JS
  run_supabase db query --linked --file "$config_sql" >/dev/null 2>&1 \
    || fail 'backend configuration failed; credential-bearing SQL output withheld'
  if [[ -f supabase/functions/notification-worker/index.ts ]]; then
    printf 'url = "https://%s.supabase.co/functions/v1/notification-worker"\nheader = "apikey: %s"\n' \
      "$project" "$BOGA_NOTIFICATION_WORKER_KEY" \
      | curl --config - --request GET --silent --show-error --fail --max-time 10 --output /dev/null \
      || fail 'notification worker verification failed; release stopped before build'
  fi
)

run_release() {
  record="$1"
  source "$record/job.env"
  mkdir "$record/started" || fail 'job already started; inspect its status before retrying'
  stage=waiting
  lock=''
  trap 'result=$?; printf "%s (exit %s)\n" "$stage" "$result" > "$record/status"; if [[ -n "$lock" ]]; then rmdir "$lock"; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  local remaining
  while (( $(date +%s) < at_epoch )); do
    remaining=$((at_epoch - $(date +%s)))
    (( remaining > 60 )) && remaining=60
    (( remaining > 0 )) && sleep "$remaining"
  done
  cd "$release_root"
  source scripts/worktree-lib.sh
  mkdir -p "$(boga_config_root)/releases/locks"
  local candidate_lock="$(boga_config_root)/releases/locks/$project"
  mkdir "$candidate_lock" || fail 'another release holds this backend lock'
  lock="$candidate_lock"
  stage=source-update
  assert_source
  local scheduled_sha="$sha" source_tree success_file
  if [[ "$ref" == origin/main ]]; then
    git pull --ff-only origin main
    sha="$(git rev-parse HEAD)"
    [[ "$sha" == "$(git rev-parse FETCH_HEAD)" ]] || fail 'origin/main moved behind this checkout; reschedule the release'
    assert_source
  fi
  printf '%s\n' "$sha" > "$record/commit.txt"
  source_tree="$(git rev-parse 'HEAD^{tree}')"
  success_file="$(boga_config_root)/releases/last-uploaded-${project}-${profile}.tree"
  if [[ -f "$success_file" && "$(cat "$success_file")" == "$source_tree" ]]; then
    stage='skipped; tracked source unchanged since last successful upload'
    echo "[ios-release] $stage. Commit: $sha"
    return
  fi
  # Refresh generated config when the pull changed its checked-in template.
  if [[ "$sha" != "$scheduled_sha" ]]; then ./boga worktree start; fi
  stage=preflight
  assert_source
  load_hosted_env
  source supabase/scripts/_common.sh
  docker info >/dev/null 2>&1 || fail 'start Docker before releasing'
  [[ ! -L apps/mobile/node_modules ]] || fail 'mobile dependencies must be worktree-local'
  (cd apps/mobile && npm ci)
  local environment bundle
  environment="$(jq -er --arg p "$profile" '.build[$p].environment' apps/mobile/eas.json)"
  bundle="$(jq -er --arg p "$profile" '.build[$p].env.IOS_BUNDLE_ID' apps/mobile/eas.json)"
  [[ "$bundle" == "$(jq -er --arg p "$profile" '.submit[$p].ios.bundleIdentifier' apps/mobile/eas.json)" ]] \
    || fail 'build and submission bundle IDs differ'
  (cd apps/mobile && npx eas-cli env:pull "$environment" --non-interactive --path .env.local >/dev/null)
  # Parse dotenv as data, never shell code. Profile overrides are part of EAS's input.
  local public_url public_key
  public_url="$(read_build_env EXPO_PUBLIC_SUPABASE_URL)"
  public_key="$(read_build_env EXPO_PUBLIC_SUPABASE_ANON_KEY)"
  [[ "$public_url" == "https://${project}.supabase.co" && -n "$public_key" ]] \
    || fail 'selected EAS environment does not match the authorized backend'
  export EXPO_PUBLIC_SUPABASE_URL="$public_url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$public_key"
  (cd apps/mobile && npx expo config --json) \
    | jq -e '{version, releaseCodename: .extra.releaseCodename, projectId: .extra.eas.projectId}' > "$record/identity.json"
  assert_source
  run_supabase link --project-ref "$project" --yes
  [[ "$(cat supabase/.temp/project-ref)" == "$project" ]] || fail 'linked project mismatch'
  check_migrations before
  run_supabase migration list --linked
  run_supabase db push --linked --include-all --dry-run
  stage=migrations
  run_supabase db push --linked --include-all --yes
  check_migrations after
  stage=functions
  # Per-function JWT settings come from this checkout's generated config.toml.
  run_supabase functions deploy --project-ref "$project"
  stage=backend-configuration
  configure_backend
  run_supabase migration list --linked
  stage=build
  assert_source
  (cd apps/mobile && npx eas-cli build --platform ios --profile "$profile" \
    --local --non-interactive --output "$record/app.ipa")
  stage=ipa-inspection
  assert_source
  unzip -q "$record/app.ipa" -d "$record/extracted"
  local app actual_bundle version build
  app="$(find "$record/extracted/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
  [[ -n "$app" ]] || fail 'IPA contains no app'
  actual_bundle="$(plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist")"
  version="$(plutil -extract CFBundleShortVersionString raw -o - "$app/Info.plist")"
  build="$(plutil -extract CFBundleVersion raw -o - "$app/Info.plist")"
  [[ "$actual_bundle" == "$bundle" && "$version" == "$(jq -r .version "$record/identity.json")" && -n "$build" ]] \
    || fail 'IPA identity does not match this release'
  printf 'Bundle: %s\nVersion: %s\nBuild: %s\n' "$actual_bundle" "$version" "$build" > "$record/ipa.txt"
  (cd "$record" && shasum -a 256 app.ipa > app.ipa.sha256 && shasum -a 256 -c app.ipa.sha256)
  stage=submission
  (cd apps/mobile && npx eas-cli submit --platform ios --profile "$profile" \
    --path "$record/app.ipa" --non-interactive --wait)
  printf '%s\n' "$source_tree" > "$success_file.tmp"
  mv "$success_file.tmp" "$success_file"
  stage='uploaded; Apple processing, tester availability, hosted smoke, and device verification pending'
  echo "[ios-release] $stage. Artifacts: $record"
}

read_build_env() {
  node - "$1" "$profile" <<'JS'
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const [name, profile] = process.argv.slice(2);
const values = { ...parseEnv(fs.readFileSync('apps/mobile/.env.local', 'utf8')),
  ...JSON.parse(fs.readFileSync('apps/mobile/eas.json')).build[profile].env };
process.stdout.write(values[name] || '');
JS
}

repeat_release() {
  record="$1"
  source "$record/job.env"
  mkdir "$record/started" || fail 'job already started; inspect its status before retrying'
  stage=recurring
  trap 'result=$?; printf "%s (exit %s)\n" "$stage" "$result" > "$record/status"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  mkdir "$record/runs"
  local run_dir name
  while true; do
    run_dir="$(mktemp -d "$record/runs/run.XXXXXX")"
    for name in release_root sha ref profile project at_epoch; do
      printf '%s=%q\n' "$name" "${!name}"
    done > "$run_dir/job.env"
    printf '%s\n' "$run_dir" > "$record/latest-run.txt"
    stage="recurring; scheduled epoch $at_epoch; artifacts $run_dir"
    printf '%s\n' "$stage" > "$record/status"
    echo "[ios-release] Next run: $(node -p 'new Date(Number(process.argv[1])*1000).toISOString()' "$at_epoch"); artifacts: $run_dir"
    # A separate shell preserves fail-fast behavior inside the conditional pipeline.
    if /bin/bash "$record/runner.sh" --run "$run_dir" 2>&1 | tee "$run_dir/release.log"; then
      sha="$(cat "$run_dir/commit.txt")"
    else
      stage="stopped after failed run; inspect $run_dir"
      return 1
    fi
    at_epoch=$((at_epoch + repeat_seconds))
    # Overruns never queue overlapping releases.
    while (( at_epoch <= $(date +%s) )); do at_epoch=$((at_epoch + repeat_seconds)); done
  done
}

if [[ "${1:-}" == --run ]]; then
  [[ $# == 2 ]] || fail 'invalid worker invocation'
  # Child records omit repetition; never inherit the parent's exported interval.
  repeat_seconds=0
  source "$2/job.env"
  if (( ${repeat_seconds:-0} > 0 )); then repeat_release "$2"; else run_release "$2"; fi
  exit
fi

at='' every='' repeat_seconds=0 profile='' project='' ref=origin/main dry=0
while (( $# )); do
  case "$1" in
    --at|--every|--profile|--project-ref|--ref)
      [[ $# -ge 2 && -n "$2" ]] || fail "$1 requires a value"
      case "$1" in
        --at) at="$2" ;; --every) every="$2" ;; --profile) profile="$2" ;; --project-ref) project="$2" ;; --ref) ref="$2" ;;
      esac
      shift 2 ;;
    --dry-run) dry=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[[ "$profile" == preview || "$profile" == prod ]] || fail '--profile must be preview or prod'
[[ "$project" =~ ^[a-z0-9]{20}$ ]] || fail '--project-ref must be a 20-character hosted project ref'
[[ -n "$at" || -z "$every" ]] || at=now
at_epoch="$(node - "$at" <<'JS'
const value = process.argv[2];
if (value === 'now') { console.log(Math.floor(Date.now()/1000)); process.exit(); }
const date = new Date(value);
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) || !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value.replace('Z', '.000Z') || date.getTime() <= Date.now()) {
  console.error('--at must be now or a future UTC time: YYYY-MM-DDTHH:MM:SSZ'); process.exit(1);
}
console.log(date.getTime()/1000);
JS
)"
repeat_seconds="$(node - "$every" "$at_epoch" <<'JS'
const [value, first] = process.argv.slice(2);
if (!value) { console.log(0); process.exit(); }
const match = /^([0-9]+)h$/.exec(value);
const seconds = Number(match?.[1]) * 3600;
if (!Number.isSafeInteger(seconds) || seconds <= 0) {
  console.error('--every must be a positive whole number of hours, e.g. 4h, 12h or 24h');
  process.exit(1);
}
if (!Number.isFinite(new Date((Number(first) + seconds) * 1000).getTime())) {
  console.error('--every exceeds the supported date range'); process.exit(1);
}
console.log(seconds);
JS
)"

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$script")/.."
source scripts/worktree-lib.sh
if (( ! dry )); then git fetch --quiet origin; fi
sha="$(git rev-parse --verify --end-of-options "$ref^{commit}")"
printf '[ios-release] %s at %s; starting commit %s; backend %s\n' "$profile" "$at" "$sha" "$project"
if (( repeat_seconds > 0 )); then echo "[ios-release] Repeats every $every; stops on failure or cancellation."; fi
if (( dry )); then
  echo '[ios-release] Plan: pull origin/main at run time (other refs pinned) → skip unchanged source → migrate → deploy all functions → configure workers → local build → inspect IPA → submit. No gates. No job created.'
  exit
fi
[[ "$(uname -s)" == Darwin ]] || fail 'local iOS releases require macOS'
for tool in caffeinate npm npx jq unzip shasum plutil tee; do command -v "$tool" >/dev/null || fail "missing $tool"; done
load_hosted_env
mkdir -p "$(boga_config_root)/releases"
record="$(mktemp -d "$(boga_config_root)/releases/ios-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
release_parent="$(boga_worktree_root)"
mkdir -p "$release_parent"
release_parent="$(cd "$release_parent" && pwd)"
release_name="$(basename "$record")"
release_root="$release_parent/$release_name"
./boga worktree create --detach --from "$sha" --root "$release_parent" --name "$release_name"
cp "$script" "$record/runner.sh"
for name in release_root sha ref profile project at_epoch repeat_seconds; do printf '%s=%q\n' "$name" "${!name}"; done > "$record/job.env"
printf 'scheduled\n' > "$record/status"
# shortcut: in-memory schedules cannot survive reboot/logout; use launchd if persistence is required.
node - "$record" <<'JS'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const record = process.argv[2];
const log = fs.openSync(`${record}/release.log`, 'a');
const job = spawn('caffeinate', ['-i', '/bin/bash', `${record}/runner.sh`, '--run', record],
  { detached: true, stdio: ['ignore', log, log] });
job.on('error', () => { console.error('Could not start scheduled release'); process.exitCode = 1; });
job.once('spawn', () => {
  fs.writeFileSync(`${record}/pid`, `${job.pid}\n`);
  job.unref();
});
fs.closeSync(log);
JS
printf '[ios-release] PID: %s\nCheckout: %s\nArtifacts/log: %s\n' "$(cat "$record/pid")" "$release_root" "$record"
