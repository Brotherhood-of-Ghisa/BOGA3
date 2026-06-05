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
