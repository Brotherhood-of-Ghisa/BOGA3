# Schedule an iOS build and submission

In Terminal, from the BOGA3 folder on your configured Mac, paste this command:

```bash
./boga worktree start && ./boga ios release \
  --at 2026-10-18T01:00:00Z --profile prod \
  --project-ref YOUR_SUPABASE_PROJECT_REF
```

Replace the time with your desired future **UTC** time and the project ref with
your Supabase project's 20-character ID.

The command sets up a one-time background job. At that time it pulls `main`,
applies migrations, deploys the backend, builds the app and uploads it to Apple.
Unchanged source skips the release. It prints the job's PID and log location.

Keep the Mac powered on, logged in and lid open, with Docker running. Expo/Apple
and Supabase credentials must already be configured. For setup, logs or
cancellation, use the [operator reference](procedures/ios-release.md).
