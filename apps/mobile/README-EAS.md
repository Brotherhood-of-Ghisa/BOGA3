# EAS Build And Submit

Run these commands from `apps/mobile`.

## Dev

Build the dev iOS app:

```bash
eas build --platform ios --profile dev
```

Build the same profile locally when you need a physical-phone dev client without
remote build minutes:

```bash
eas build --platform ios --profile dev --local
```

Detailed local install/run instructions live in
`apps/mobile/README-LOCAL-DEV-BUILD.md`.

Upload a local build to EAS for a shareable install link:

```bash
eas upload --platform ios --build-path ../../artifacts/builds/boga3-dev.ipa
```

For iOS, teammate devices must be included in the ad hoc provisioning profile.
Register new phones with `eas device:create`, then rebuild with
`--refresh-ad-hoc-provisioning-profile` before uploading.

After install, the shared `dev` build still needs Metro: use `npx expo start
--dev-client --host lan --scheme boga3 --port <worktree-port>` for same-LAN
testing, or `--tunnel` for a remote teammate.

Submit the latest dev iOS build:

```bash
eas submit --platform ios --profile dev --latest
```

Profile mapping:

- App name: `Boga3 Dev`
- Bundle ID: `com.phano.boga3.dev`

## Prod

Build the prod iOS app:

```bash
eas build --platform ios --profile prod
```

Build the same prod profile locally when you need the App Store IPA produced on
this Mac instead of by an EAS remote worker:

```bash
mkdir -p ../../artifacts/builds

eas build \
  --platform ios \
  --profile prod \
  --local \
  --non-interactive \
  --output ../../artifacts/builds/boga3-prod.ipa
```

The local build still contacts EAS for project metadata, signing credentials,
and production environment values. It just runs the native build on this Mac.

Submit the local prod IPA to App Store Connect:

```bash
eas submit \
  --platform ios \
  --profile prod \
  --path ../../artifacts/builds/boga3-prod.ipa
```

Submit the latest prod iOS build:

```bash
eas submit --platform ios --profile prod --latest
```

Profile mapping:

- App name: `Boga3`
- Bundle ID: `com.phano.boga3`

## Config

`eas.json` owns the EAS profile names, bundle IDs, App Store Connect app IDs,
auto-increment behavior, and EAS environment mapping.
