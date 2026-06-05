# Local iPhone Dev Build

Use this when you need an installable development-client build on a real iPhone
without spending remote EAS build minutes. The checked-in EAS profile is
`dev`, not `development`.

## What This Produces

- An ad hoc iOS development-client IPA for `com.phano.boga3.dev`.
- A locally extracted `.app` that can be installed with `xcrun devicectl`.
- A Metro dev-server loop that the installed phone app can load over Wi-Fi.

The build runs on this Mac. It may still contact EAS to read project metadata,
remote credentials, and EAS environment values. That does not use a remote build
worker.

## Prerequisites

- Xcode command line tools.
- Node/npm dependencies installed in `apps/mobile`.
- EAS login with access to `@brotherhood-of-ghisa/boga3`.
- The iPhone UDID must be registered on the Apple team used by the ad hoc
  provisioning profile.
- Mac and iPhone must be on the same local network for Metro and local Supabase.
- Docker Desktop or Colima must be running when connecting the app to local
  Supabase.

Useful checks:

```bash
cd /Users/sboschi/Code/BOGA3
./scripts/worktree-setup.sh

cd apps/mobile
npm install
npx eas-cli whoami
npx eas-cli device:list --apple-team-id 89BUGQ8K7C
```

Register a new phone before building if it is missing from `device:list`:

```bash
cd /Users/sboschi/Code/BOGA3/apps/mobile
npx eas-cli device:create
```

## Point The App At Local Supabase

For a physical phone, `localhost` means the phone itself. Use the Mac LAN IP in
the mobile env:

```bash
cd /Users/sboschi/Code/BOGA3
./supabase/scripts/use-local-mobile-lan-env.sh
```

This starts or reuses local Supabase, writes `apps/mobile/.env.local` with
`EXPO_PUBLIC_SUPABASE_URL=http://<mac-lan-ip>:<slot-api-port>`, and keeps the
client-safe anon key in that file.

If auto-detection picks the wrong interface:

```bash
BOGA_MOBILE_LAN_HOST=<mac-lan-ip> ./supabase/scripts/use-local-mobile-lan-env.sh
```

Restart Metro after every local/hosted Supabase switch so `EXPO_PUBLIC_*` values
are rebundled.

## Build Locally

Run from `apps/mobile`:

```bash
cd /Users/sboschi/Code/BOGA3/apps/mobile
mkdir -p ../../artifacts/builds

npx eas-cli build \
  --platform ios \
  --profile dev \
  --local \
  --non-interactive \
  --output ../../artifacts/builds/boga3-dev.ipa
```

Expected output:

```text
Build successful
You can find the build artifacts in .../artifacts/builds/boga3-dev.ipa
```

If you changed native dependencies or app config and want to avoid stale native
state, add `--clear-cache`.

## Extract The App For CLI Install

`devicectl` installs a `.app`, not an `.ipa`.

```bash
cd /Users/sboschi/Code/BOGA3
rm -rf artifacts/builds/boga3-dev-extracted
mkdir -p artifacts/builds/boga3-dev-extracted
unzip -q artifacts/builds/boga3-dev.ipa -d artifacts/builds/boga3-dev-extracted
find artifacts/builds/boga3-dev-extracted/Payload -maxdepth 1 -name '*.app' -type d -print
```

Expected app path:

```text
/Users/sboschi/Code/BOGA3/artifacts/builds/boga3-dev-extracted/Payload/Boga3Dev.app
```

## Install On The iPhone

Plug in the phone, unlock it, trust this Mac, then run:

```bash
xcrun devicectl list devices

DEVICE="<device name or UDID from devicectl>"
xcrun devicectl device install app \
  --device "$DEVICE" \
  /Users/sboschi/Code/BOGA3/artifacts/builds/boga3-dev-extracted/Payload/Boga3Dev.app
```

If `devicectl` shows no devices, keep the phone unlocked, reconnect the cable,
and open Xcode's Devices and Simulators window once so the device provider wakes
up.

## Start Metro For The Phone

Use this worktree's Metro port from `.maestro/maestro.env.local`:

```bash
cd /Users/sboschi/Code/BOGA3/apps/mobile
set -a
source .maestro/maestro.env.local
set +a

npx expo start \
  --dev-client \
  --host lan \
  --scheme boga3 \
  --port "$EXPO_DEV_SERVER_PORT"
```

Scan the QR code shown by Expo with the iPhone, or open the dev-client URL
manually.

To print a manual URL:

```bash
LAN_HOST="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
node -e 'const host = process.argv[1]; const port = process.argv[2]; const url = `http://${host}:${port}`; console.log(`exp+boga3://expo-development-client/?url=${encodeURIComponent(url)}`);' "$LAN_HOST" "$EXPO_DEV_SERVER_PORT"
```

## Troubleshooting

- `Cannot connect to the Docker daemon`: start Docker Desktop or Colima, then
  rerun `./supabase/scripts/use-local-mobile-lan-env.sh`.
- Phone cannot load Metro: confirm Mac and phone are on the same Wi-Fi, restart
  Metro with `--host lan`, and check macOS firewall prompts.
- Phone can load the app but auth/sync is disabled: rerun
  `./supabase/scripts/use-local-mobile-lan-env.sh`, then restart Metro.
- Install fails with provisioning/device errors: register the phone with
  `npx eas-cli device:create`, then rebuild so the ad hoc profile includes it.
- Local build fails at `expo doctor`: fix or explicitly accept the reported
  project issue before relying on the build.
