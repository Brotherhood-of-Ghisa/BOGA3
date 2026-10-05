# Running a development build on a physical iPhone

Load when you are running or debugging the app on a real iPhone — on the LAN,
over Tailscale, or behind an Expo tunnel. Simulator loop, dev accounts, local
Supabase and logs are in `RUNBOOK.md`.

A real iPhone needs two things: an installed development-client build, and a
reachable Metro bundler — plus a reachable Supabase for auth/sync. **Building,
signing, installing** the dev client (local `eas build --profile dev --local`,
ad hoc install via `xcrun devicectl`, device registration) is
`apps/mobile/README-LOCAL-DEV-BUILD.md`. This doc is the day-to-day run loop
once that build is on the phone.

## On the same Wi-Fi: dev-lan.sh

```bash
./scripts/dev/dev-lan.sh
```

One command: boots this checkout's Supabase (the `BOGA-dev` stack from the main
checkout, the slot stack from a linked worktree), runs the dev DB baseline
(pending migrations in place + dev account seed, never a reset), points
`apps/mobile/.env.local` at the Mac's LAN IP, and starts Expo/Metro over the LAN
in `--dev-client` mode. Open the dev client on the phone — scan the QR code Expo
prints, or open the dev-client URL. Extra args forward to `expo start`
(`--clear`).

Supabase containers persist after you Ctrl+C Expo; stop them with
`./boga db dev-down` (main checkout) or `./boga db down` (linked worktree).

### Why the LAN IP matters

On a phone, `localhost` / `127.0.0.1` resolves to the **phone itself**, so the
app must reach Supabase over the Mac's LAN IP. The env-only half of `dev-lan.sh`
is `./boga env lan` (`scripts/dev/use-local-mobile-lan-env.sh`): it starts or
reuses local Supabase and rewrites `apps/mobile/.env.local` to
`EXPO_PUBLIC_SUPABASE_URL=http://<mac-lan-ip>:<slot-api-port>`, keeping the
client-safe anon key. If auto-detection picks the wrong interface, pin it:

```bash
BOGA_MOBILE_LAN_HOST=<mac-lan-ip> ./scripts/dev/use-local-mobile-lan-env.sh
```

**Restart Metro after any env switch** so `EXPO_PUBLIC_*` values are rebundled.

### Running the pieces by hand

```bash
./boga env lan
cd apps/mobile
set -a; source .maestro/maestro.env.local; set +a
npx expo start --dev-client --host lan --scheme boga3 --port "$EXPO_DEV_SERVER_PORT"
```

## Off the LAN: dev-remote.sh (Tailscale)

When the phone is **not** on the same Wi-Fi — cellular, a different building,
guest Wi-Fi with client isolation — route the whole session over your tailnet.
This keeps the **local** Supabase and Metro: no hosted backend and no dev-client
rebuild.

```bash
./scripts/dev/dev-remote.sh
```

It boots this slot's Supabase, publishes it at `https://<magicdns-name>`,
rewrites `apps/mobile/.env.local` to that URL, publishes Metro at
`https://<magicdns-name>:8443`, and starts Expo. On the phone's dev client, load
the `:8443` URL the script prints.

Why HTTPS rather than the LAN flow's plain HTTP: a strict-ATS dev build (the
`com.phano.boga3.dev` TestFlight build) rejects plain HTTP to a `100.x`
Tailscale address. The trusted `*.ts.net` certificate from `tailscale serve`
sidesteps App Transport Security entirely, so the existing build works
unchanged.

One-time prerequisites:

- Tailscale installed and signed into the **same tailnet** on both this Mac and
  the phone.
- HTTPS certificates enabled for the tailnet:
  [admin → DNS](https://login.tailscale.com/admin/dns) → MagicDNS on, then
  **Enable HTTPS**. `dev-remote.sh` fails fast with this instruction if it is off.

Notes:

- The env-only half is `./boga env tailscale`
  (`scripts/dev/use-local-mobile-tailscale-env.sh`).
- Run **one worktree at a time**: the `443` / `8443` serve mappings are
  per-machine.
- Override MagicDNS detection with `BOGA_MOBILE_TS_HOST=…` and the Metro port
  with `EXPO_PORT=…`. Extra args forward to `expo start`.
- Tear down: `./boga db dev-down` (main checkout) or `./boga db down` (linked
  worktree), then
  `tailscale serve --https=443 off && tailscale serve --https=8443 off`.

## Hosted Supabase instead

```bash
./boga env hosted      # scripts/dev/use-hosted-mobile-env.sh
```

Reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `supabase/.env.hosted`.
Restart Metro afterwards. Accounts and sign-in: `RUNBOOK.md`, "Log into a
development database".

## Troubleshooting

### Phone cannot reach Expo or Metro

Symptoms: the dev client hangs on "Downloading JavaScript bundle", shows "Could
not connect to the development server", or the LAN URL / QR code times out.

Check that Mac and phone are on the **same Wi-Fi**, that you answered the macOS
firewall prompt to allow `node` / incoming connections, and that Metro was
started with `--host lan` (what `dev-lan.sh` does).

If the LAN itself is the problem — guest/corporate Wi-Fi with client isolation,
a VPN, or different subnets — route the bundler over an Expo **tunnel**:

```bash
cd apps/mobile
set -a; source .maestro/maestro.env.local; set +a
npx expo start --dev-client --tunnel --scheme boga3 --port "$EXPO_DEV_SERVER_PORT"
```

The first `--tunnel` run prompts to install `@expo/ngrok` — accept it. Scan the
QR code Expo prints over the tunnel.

> A tunnel fixes **Metro** reachability only. Local Supabase is served on the
> Mac's LAN IP, so a phone that cannot reach the LAN still cannot reach it over
> the tunnel. For a fully off-LAN setup use `dev-remote.sh`, or point the app at
> hosted Supabase (`./boga env hosted`) and restart Metro.

### Phone cannot reach Supabase

Symptoms: the app loads but login/sync fail with network errors to
`http://<ip>:<port>`, or auth/sync appears disabled.

- **Stack not up:** `./boga db up` (or `./boga db dev-up`), and confirm the
  Docker daemon answers (`docker info`); on Colima, `colima start` first.
- **Wrong host in env:** `apps/mobile/.env.local` must point at the Mac's LAN IP,
  not `127.0.0.1`. Re-run `./boga env lan` (or `dev-lan.sh`), then restart Metro.
- **Wrong interface detected:** find the IP with `ipconfig getifaddr en0` (or
  `en1`) and pin it via `BOGA_MOBILE_LAN_HOST`.
- **Reachability test:** from another device on the same Wi-Fi, open the URL
  written into `apps/mobile/.env.local`. A timeout is a network/firewall issue —
  same Wi-Fi? client isolation? macOS firewall allowing the Supabase ports?
- **Cannot share a LAN at all:** `dev-remote.sh`, or `./boga env hosted` plus a
  Metro restart. A Metro tunnel alone will not carry traffic to a LAN-only
  Supabase.
- Still stuck? See `RUNBOOK.md`, "Logs" — the Supabase container logs and the
  `public.app_logs` sync rows.
