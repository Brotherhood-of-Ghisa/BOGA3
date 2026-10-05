# Running BOGA3 on the Android Emulator

Load when you are building, running, or wiping the app on an Android emulator or
device. The iOS/simulator loop, dev accounts, local Supabase and logs are in
`RUNBOOK.md`.

## Prerequisites

- Android SDK with platform-tools and the emulator CLI. The helper honours
  `ANDROID_HOME`, then a valid legacy `ANDROID_SDK_ROOT`, then standard install
  locations including `~/Library/Android/sdk` (macOS) and `~/Android/Sdk` (Linux).
- **Java 17 or 21.** Gradle 8.x accepts those two; Java 25+ is rejected.
- An AVD (for example `Pixel_10_Pro`).

Before running `emulator`, `adb`, `gradle` or `npx expo run:android` **directly**,
source the environment helpers in your shell — they put `ANDROID_HOME`, `adb` and
`emulator` on `PATH` and set `JAVA_HOME` to a compatible JDK, clearing an
incompatible Java 25+. `./boga android …` sources them itself.

```bash
source scripts/android-env.sh
source scripts/java-env.sh
./boga android doctor        # or: ./boga doctor --android
```

## Dev-client loop

1. Boot the emulator:

   ```bash
   emulator -avd Pixel_10_Pro &
   adb wait-for-device
   ```

2. Configure the backend and `apps/mobile/.env.local`:
   - **Main checkout (slot 0):** `./boga env dev` — boots the dedicated
     `BOGA-dev` stack (port `65431`), seeds the dev accounts, and writes its URL
     and anon key.
   - **Linked worktree (slot > 0):** `./boga db up`. Linked worktrees must not
     use `BOGA-dev` (`docs/specs/12-worktree-config-and-isolation.md`); this
     boots the slot-isolated stack on port `55431 + 100 * slot` and configures
     `.env.local` itself.

3. Build and launch:

   ```bash
   ./boga android run
   ```

   The launcher resolves this worktree's generated Metro port (`8082 + slot`),
   validates it, pins the Supabase values from `apps/mobile/.env.local`, and runs
   `adb reverse` for Metro **and** for the local API port in
   `EXPO_PUBLIC_SUPABASE_URL` — `65431` for `BOGA-dev`, the slot port in a linked
   worktree. Hosted and LAN backends need no API reverse. Keep one Android target
   connected or select it with `ANDROID_SERIAL`.

Split across two terminals instead (both configure the same reverse ports):

```bash
./boga android run --no-bundler   # terminal 1: compile & launch
./boga android start              # terminal 2: Metro
```

Override Metro with `--port 8099` on **both** commands; that port is passed to
Expo and to `adb reverse`.

## Wipe the app

```bash
adb shell pm clear com.phano.boga3.dev
```

GUI equivalent: Settings → Apps → BOGA3 → Storage → Clear Storage. This clears
the SQLite database and app sandbox, which is also the required one-time step
when upgrading an install that ran v1 sync (`docs/manual-wipe-v1-to-v2.md`).
