# Build and submit an iOS release

Load when the operator requests an iOS release or asks to build, migrate and
submit one. This is a guided sequence with `preview` and `prod` options. Run
one stage at a time, stop on failure, and keep the release checkout untouched.
Use a Bash session for the fenced commands, including the sourced Supabase
helpers. Enable `set -euo pipefail` so a failed check stops subsequent commands.
Other worktrees can continue development.

## Agree the release choices upfront

Before changing metadata or starting a build, ask the operator together:

- Which profile: `preview` or `prod`? Which source ref (normally `origin/main`)?
- Keep the current release name, or change it? Keep the version, or set which
  version? Read the current values from `apps/mobile/app.config.ts` first.
- Create and push a Git tag for this release: yes or no?
- Build only, or complete the database migration and Apple submission sequence?
  Identify each backend project and the authority to migrate it; preview may
  point at production, so the profile name alone does not identify a database.

Carry forward answers and authorization already given. Keep name/version unless
a change is requested; an unanswered tagging choice means no tag. Resolve the
profile, source and deployment scope before dependent actions. A build-only
request authorizes no hosted database writes or submission.

If metadata changes, update `version` and `extra.releaseCodename` in
`apps/mobile/app.config.ts`, keeping `apps/mobile/package.json` and its lockfile
version aligned. Ship that change through the normal PR gates before selecting
the release commit. Start the release after the final metadata is committed.

The checked-in source of profile values is `apps/mobile/eas.json`; inspect it
at the release commit rather than assuming this table has never changed:

| Choice | `preview` | `prod` |
| --- | --- | --- |
| EAS build and submit profile | `preview` | `prod` |
| EAS environment | `development` | `production` |
| Expected iOS bundle ID | `com.phano.boga3.dev` | `com.phano.boga3` |
| App Store Connect app ID | `6766332857` | `6766332909` |
| Client | Store-signed development client; needs Metro | Standalone production app |
| Optional tag prefix | `preview-ios` | `prod-ios` |

EAS manages the build number remotely and increments it for both profiles.
Read the actual number from the resulting IPA; the app-config fallback is not
the EAS build number. Version behavior is described in
[Expo's app version reference](https://docs.expo.dev/build-reference/app-versions/).

## Pin the source and open the release worktree

From an existing checkout, fetch and resolve the agreed ref to a full SHA.
These commands show the normal `main` choice; substitute an explicitly agreed
ref when releasing something else:

```bash
set -euo pipefail
git fetch origin main
BOGA_RELEASE_SHA="$(git rev-parse 'origin/main^{commit}')"
printf 'Release commit: %s\n' "$BOGA_RELEASE_SHA"
./boga worktree create --detach --from "$BOGA_RELEASE_SHA" \
  --name "ios-release-$(date -u +%Y%m%dT%H%M%SZ)"
```

Switch to the new path printed by `create` in the same shell, preserving the
recorded SHA. Do not reuse the shared sweep checkout.
For lease and ownership details, load `docs/specs/01-worktree-and-environment.md`.
From this point run commands at the release worktree's root, in the same shell:

```bash
test "$(git rev-parse HEAD)" = "$BOGA_RELEASE_SHA"
BOGA_RELEASE_PROFILE=preview  # choose preview or prod from the agreed answers
test -z "$(git status --porcelain)"
mkdir -p artifacts/builds
BOGA_RELEASE_DIR="$(mktemp -d "$PWD/artifacts/builds/${BOGA_RELEASE_PROFILE}-${BOGA_RELEASE_SHA}.XXXXXX")"
printf '%s\n' "$BOGA_RELEASE_SHA" > "$BOGA_RELEASE_DIR/commit.txt"
```

Keep a release record alongside the IPA with the chosen name/version, tagging
choice, profile, EAS environment, backend targets, CLI versions and completed
stage evidence. Include no credentials. Unique output directories avoid one
release overwriting another. Coordinate releases targeting the same hosted
project: a worktree isolates source files, not the remote database.

## Validate the pinned commit

Run the required release sweep on the recorded SHA, with the lane agreement
required by `docs/specs/02-quality-and-test-gates.md`:

```bash
BOGA_RELEASE_SWEEP_DIR="${PWD}-sweep"
test ! -e "$BOGA_RELEASE_SWEEP_DIR"
BOGA_SWEEP_DIR="$BOGA_RELEASE_SWEEP_DIR" ./boga sweep --ref "$BOGA_RELEASE_SHA"
```

Record the green summary path and check its commit matches the release SHA.
The fresh sibling sweep worktree receives its own slot lease and keeps the
selected SHA even if `main` advances. On a failed sweep, inspect the summary;
if repeating it requires a fresh sweep checkout, preserve its evidence outside
it and run `./boga worktree release --force` from that run's sweep root before
recreating it.
Resolve failures before building. If a release needs an extra contract lane
outside the sweep, agree and run it too. For native changes, follow that spec's
dev-client rebuild rule. Record measured durations only via `./boga timings`.

## Migrate and verify the selected databases

For a full release targeting hosted Supabase, load
`docs/runbook-hosted-operations.md`, "Mobile release database gate", and follow
it from this pinned checkout for each agreed project. It owns project identity,
migration review, application, function deployment and hosted verification.
Record either the applied migration versions or the verified no-op.

Apply compatible migrations before building/submitting. A breaking protocol or
publication change follows its owning contract's staged cutover order; record
deferred stages explicitly. A missing or failed hosted check leaves the release
incomplete. For a preview intentionally targeting local Supabase, use
`./boga db baseline` on its own leased slot and record that target; never infer
permission to update hosted production from a preview request.

For build-only scope, record this stage as not authorized and continue to build
only. Submission remains outside that scope.

## Build and inspect the IPA

Check the selected EAS environment and any local overrides match the recorded
backend target. Check Expo/Apple credentials and the prerequisites in
`apps/mobile/README-LOCAL-DEV-BUILD.md` when setting up local builds. Install this
worktree's dependencies with `npm ci` from `apps/mobile` if needed.

Before building, both checks below must pass:

```bash
test "$(git rev-parse HEAD)" = "$BOGA_RELEASE_SHA"
test -z "$(git status --porcelain)"
(
  cd apps/mobile
  npx eas-cli build --platform ios --profile "$BOGA_RELEASE_PROFILE" \
    --local --non-interactive --output "$BOGA_RELEASE_DIR/app.ipa" \
    2>&1 | tee "$BOGA_RELEASE_DIR/build.log"
)
```

Keep the checkout untouched until inspection and tagging finish. Extract and
read the built binary, then compare its bundle ID with the selected profile
and its version with the agreed version:

```bash
mkdir "$BOGA_RELEASE_DIR/extracted"
unzip -q "$BOGA_RELEASE_DIR/app.ipa" -d "$BOGA_RELEASE_DIR/extracted"
BOGA_RELEASE_APP="$(find "$BOGA_RELEASE_DIR/extracted/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
test -n "$BOGA_RELEASE_APP"
BOGA_RELEASE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BOGA_RELEASE_APP/Info.plist")"
BOGA_RELEASE_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$BOGA_RELEASE_APP/Info.plist")"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BOGA_RELEASE_APP/Info.plist"
printf 'Version %s (build %s)\n' "$BOGA_RELEASE_VERSION" "$BOGA_RELEASE_BUILD"
(
  cd "$BOGA_RELEASE_DIR"
  shasum -a 256 app.ipa > app.ipa.sha256
)
```

Record these values and the build log path. Stop on a mismatch. When checking
Settings → About in preview, serve Metro from this pinned checkout so its
release codename comes from the intended source.

## Submit the exact IPA

For full scope, require the database gate's migration/history checks and initial
hosted smoke, plus IPA inspection, to be green before submission. Keep final
verification with the submitted release client pending until it is available;
staged cutovers follow their owning contract.
Verify the recorded checksum, then submit using the same profile:

```bash
(
  cd "$BOGA_RELEASE_DIR"
  shasum -a 256 -c app.ipa.sha256
)
(
  cd apps/mobile
  npx eas-cli submit --platform ios --profile "$BOGA_RELEASE_PROFILE" \
    --path "$BOGA_RELEASE_DIR/app.ipa" --non-interactive --wait \
    2>&1 | tee "$BOGA_RELEASE_DIR/submit.log"
)
```

Record the submission ID/URL and result. Verify processing and tester availability
in App Store Connect; upload success alone does not prove those states. App Store
review and public release are separate actions, described in
[Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).
Complete any coordinated backend cutover and hosted checks before reporting the
full release complete.

## Apply the optional tag and close out

If tagging was declined, record "not requested". If agreed, tag after a successful
build-only result or the completed full release. Use the recorded SHA explicitly:

```bash
BOGA_RELEASE_TAG="${BOGA_RELEASE_PROFILE}-ios-v${BOGA_RELEASE_VERSION}-b${BOGA_RELEASE_BUILD}"
test -z "$(git tag --list "$BOGA_RELEASE_TAG")"
BOGA_RELEASE_REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/$BOGA_RELEASE_TAG")"
test -z "$BOGA_RELEASE_REMOTE_TAG"
```

All checks must succeed. A remote lookup failure stops the sequence; it is not
evidence of absence. If either tag exists, inspect it and stop rather than
overwrite it. Then:

```bash
git tag -a "$BOGA_RELEASE_TAG" "$BOGA_RELEASE_SHA" \
  -m "BoGa ${BOGA_RELEASE_PROFILE} iOS v${BOGA_RELEASE_VERSION} build ${BOGA_RELEASE_BUILD}"
git push origin "refs/tags/$BOGA_RELEASE_TAG"
test "$(git rev-parse "$BOGA_RELEASE_TAG^{commit}")" = "$BOGA_RELEASE_SHA"
```

The legacy `scripts/dev/tag-preview-ios.sh` tags current `HEAD`; this sequence
uses an explicit SHA instead. Record the tag and push result separately.

Report the commit, codename/version/build, IPA checksum, sweep evidence, each
database result, Apple status and tag result. On failure, resume from the first
unfinished stage using the same SHA and IPA; a rebuild gets a new artifact record.
After an uncertain submission, inspect its status before retrying. After a tag
push failure, verify the existing local tag before retrying the push. Recheck
remote migration history before resuming migrations; never reset or repair
history as an automatic recovery step.

Preserve the IPA, release record and sweep evidence outside both worktrees
before removing them. From the release worktree's root, stop its stack with
`./boga db down`, then run `./boga worktree release --force`. From this run's
sibling sweep worktree's root, run `./boga worktree release --force` too.
Both worktrees are detached, so there is no branch PR for `release` to check.
This procedure authorizes `--force` only for the release and sibling sweep
worktrees created by this run; leave other runs' checkouts alone. An incomplete
release retains its artifacts and outstanding-stage record for resumption.
