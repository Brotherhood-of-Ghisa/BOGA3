#!/usr/bin/env bash

# One-shot local release; no test lanes or sweep. See --help before scheduling.
set -euo pipefail
umask 077

fail() { echo "[ios-release] $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./boga ios release --at <UTC time|now> --profile <preview|prod>
                        --project-ref <Supabase ref> [--ref <git ref>] [--dry-run]

Example: ./boga ios release --at 2026-10-18T01:00:00Z --profile prod \
           --project-ref <your-project-ref>

Pins the source now (default: freshly fetched origin/main), creates a detached
release worktree, and starts a background job on this Mac. At the selected time:
  1. Install isolated mobile dependencies and check the EAS/backend identity.
  2. Apply migrations without seeds/reset; deploy every checked-in Edge Function.
  3. Configure group evaluation and notification invocation/registration.
  4. Build locally, inspect/checksum the IPA, and submit that IPA to Apple.

No gates, sweep, metadata changes, Git tags, or automatic retries.
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
This one-shot background job does not survive logout/reboot. No Render/consent-site
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
    || fail 'release checkout changed after scheduling'
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
  # Read the project's actual worker credential; never put it in argv or logs.
  if [[ -f supabase/functions/notification-worker/index.ts ]]; then
    SUPABASE_SERVICE_ROLE_KEY="$(run_supabase projects api-keys --project-ref "$project" -o json \
      | jq -er '.[] | select(.name == "service_role") | .api_key')"
    export SUPABASE_SERVICE_ROLE_KEY
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
  notification_worker_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
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

if [[ "${1:-}" == --run ]]; then
  [[ $# == 2 ]] || fail 'invalid worker invocation'
  run_release "$2"
  exit
fi

at='' profile='' project='' ref=origin/main dry=0
while (( $# )); do
  case "$1" in
    --at|--profile|--project-ref|--ref)
      [[ $# -ge 2 && -n "$2" ]] || fail "$1 requires a value"
      case "$1" in
        --at) at="$2" ;; --profile) profile="$2" ;; --project-ref) project="$2" ;; --ref) ref="$2" ;;
      esac
      shift 2 ;;
    --dry-run) dry=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done
[[ "$profile" == preview || "$profile" == prod ]] || fail '--profile must be preview or prod'
[[ "$project" =~ ^[a-z0-9]{20}$ ]] || fail '--project-ref must be a 20-character hosted project ref'
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
script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$script")/.."
source scripts/worktree-lib.sh
if (( ! dry )); then git fetch --quiet origin; fi
sha="$(git rev-parse --verify --end-of-options "$ref^{commit}")"
printf '[ios-release] %s at %s; commit %s; backend %s\n' "$profile" "$at" "$sha" "$project"
if (( dry )); then
  echo '[ios-release] Plan: migrate → deploy all functions → configure workers → local build → inspect IPA → submit. No gates. No job created.'
  exit
fi
[[ "$(uname -s)" == Darwin ]] || fail 'local iOS releases require macOS'
for tool in caffeinate npm npx jq unzip shasum plutil; do command -v "$tool" >/dev/null || fail "missing $tool"; done
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
for name in release_root sha profile project at_epoch; do printf '%s=%q\n' "$name" "${!name}"; done > "$record/job.env"
printf 'scheduled\n' > "$record/status"
# shortcut: a one-shot process cannot survive reboot/logout; use launchd if that becomes required.
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
