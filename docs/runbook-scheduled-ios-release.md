# Schedule an iOS build and submission

Open Terminal in the BOGA3 folder (the one containing `boga`). Choose one command
below and replace `YOUR_SUPABASE_PROJECT_REF` with your project's 20-character ID.

## Daily — every 24 hours

```bash
./boga worktree start && ./boga ios release --every 24h \
  --profile prod --project-ref YOUR_SUPABASE_PROJECT_REF
```

## Every 4 hours

```bash
./boga worktree start && ./boga ios release --every 4h \
  --profile prod --project-ref YOUR_SUPABASE_PROJECT_REF
```

For another interval, replace `4h` with any positive whole number of hours,
for example `12h`, `1h` or `48h`.

These recurring commands **start immediately**, then repeat at the chosen interval.
To choose the first run instead, add `--at 2026-10-18T22:00:00Z`, replacing it with
your desired future UTC time. Intervals stay fixed in UTC across daylight-saving
changes.

## Once at a chosen time

```bash
./boga worktree start && ./boga ios release \
  --at 2026-10-18T22:00:00Z --profile prod \
  --project-ref YOUR_SUPABASE_PROJECT_REF
```

The command sets up a background job and prints its PID and log location. Each run
pulls `main`, applies migrations, deploys the backend, builds the app and uploads
it to Apple. Unchanged source skips that run. Recurring runs share one release
checkout and stop after any failure; inspect the logs before scheduling again.

To stop all future runs, use the printed PID:

```bash
kill -TERM -- -PRINTED_PID
```

Keep the Mac powered on, logged in and lid open, with Docker running. The job
stops on logout/reboot. Expo/Apple and Supabase credentials must already be
configured. For setup, logs or cleanup, use the
[operator reference](procedures/ios-release.md).
