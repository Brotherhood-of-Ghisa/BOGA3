---
task_id: T-20260911-01-improve-settings-and-mcp-onboarding
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; ./boga test mcp-smoke"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/ux-rules.md, apps/agent-auth-web/README.md"
---

# Improve Settings and MCP Onboarding

## Task metadata

- Task ID: `T-20260911-01-improve-settings-and-mcp-onboarding`
- Title: Improve Settings and MCP Onboarding
- Status: `completed`
- Session date: 2026-09-11
- Session interaction mode: `interactive`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: N/A - user-requested post-M21 UX improvement; use
  `docs/specs/milestones/M21-boga-mcp-virtual-coach.md` as the implemented MCP
  and OAuth architecture reference without reopening the completed milestone.
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Auth/API guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Agent authorization operations: `apps/agent-auth-web/README.md`
- MCP service operations: `services/boga-mcp/README.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit for implementation: `main` at
  `9cb5d802abd6fd68a5225bf5b5497d0ba1135006`.
- Start-of-session sync with `origin/main` completed?: `yes` - fetched `origin`
  on 2026-09-11 and confirmed `HEAD` and `origin/main` are identical (`0` ahead /
  `0` behind).
- Parent refs opened in this planning session:
  - `AGENTS.md`
  - `docs/specs/README.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/06-testing-strategy.md` (relevant mobile, consent-web, MCP, and
    iOS gate sections)
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/10-api-authn-authz-guidelines.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M21-boga-mcp-virtual-coach.md`
  - `docs/specs/templates/task-card-template.md`
  - `apps/agent-auth-web/README.md`
  - `services/boga-mcp/README.md`
  - `supabase/README.md`
- Code/docs inventory freshness checks run:
  - Reviewed the current Settings route, profile/Connected-agents exits,
    preferences, sync panel, and developer-tools layout on 2026-09-11.
  - Reviewed Expo app version, iOS build number, optional release codename,
    and existing app-flavor/runtime metadata helpers on 2026-09-11.
  - Reviewed the authorization web startup and consent request validation on
    2026-09-11; the consent flow currently requires a valid
    `authorization_id` and deliberately rejects a direct request without one.
  - Reviewed the hosted setup URL and MCP endpoint recorded in the colocated
    READMEs on 2026-09-11.
  - Ran `./boga test for` against the expected mobile, consent-web, test, and UI
    docs paths on 2026-09-11; the required path-triggered union was `fast`,
    `frontend`, and `docs-check` (`docs-check` is included by `fast`).
- Known stale references or assumptions:
  - None at implementation start. Reverified `GET /` and `GET /connect` on the
    recorded Cloudflare host as HTTP 200 and the Render MCP endpoint as the
    expected unauthenticated HTTP 401 on 2026-09-11. This is reachability
    evidence, not evidence that the new setup-page content has been deployed.
- Recommended implementation bootstrap:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260911-01-improve-settings-and-mcp-onboarding.md`

## Objective

Turn Settings into a clearer account and support surface by adding a visible
screen title, coherent sections, installed app release metadata, and a safe
entry point for learning how to connect an MCP-compatible AI coach. Preserve
the existing Connected agents review/revocation flow and the OAuth security
boundary: authorization starts in the MCP client, not from a fabricated or
directly opened consent request in the mobile app.

## Scope

### In scope

- Add a visible `Settings` heading and organize the screen into these sections,
  in order:
  - Account
  - AI coaching
  - Preferences
  - Data & sync
  - About
  - Developer tools, when `isDevMode()` is true
- Rename the current Profile destination to the user-facing Account concept and
  show signed-in email context when available; retain the existing `/profile`
  destination and signed-out behavior.
- Add an `AI coaching` section with two distinct actions:
  - `Connect an AI coach`, which opens a stable first-party public setup page in
    the system browser.
  - `Connected agents`, which keeps the existing signed-in-only in-app review
    and revocation route.
- State near the coaching actions that agent access is read-only and revocable.
- Add compact About metadata sourced from the installed app/runtime:
  - semantic app version;
  - native build number when available;
  - release codename when configured and nonblank;
  - app flavor for preview/local builds only, not as noise in production.
- Use the installed native version/build as the primary source and Expo config
  as the development/test fallback. Centralize this resolution in a small,
  testable mobile helper; if the existing logging metadata resolver is moved to
  that helper, preserve its current payload semantics exactly.
- Make the first-party connect-page URL public, non-secret configuration with a
  checked-in hosted default and a build-time override. Do not place OAuth state,
  credentials, tokens, or Supabase secrets in the URL/config.
- Add a safe public setup state to `apps/agent-auth-web`:
  - `/` and `/connect` render connection instructions without requiring an
    OAuth authorization request;
  - `/oauth/consent` continues to require and validate
    `authorization_id` before sign-in or approval;
  - invalid or missing consent state on `/oauth/consent` remains a fail-closed
    error, never a silent setup-page fallback.
- The setup page explains the public MCP endpoint, that connection begins in
  the user's MCP client, the read-only data boundary, and where to revoke an
  existing connection.
- Handle failure to launch the external browser with concise inline feedback
  beside the Connect action while leaving the action retryable.
- Add/update focused mobile and consent-web tests, current UI documentation,
  operational documentation, and visual evidence.

### Out of scope

- Starting an OAuth authorization-code flow from the mobile app.
- Generating, guessing, persisting, or forwarding `authorization_id`, callback
  URLs, access tokens, refresh tokens, or the mobile Supabase session.
- Changing Supabase OAuth configuration, grants, RLS, the agent API, the MCP
  endpoint/protocol, the four MCP tools, or their read-only permissions.
- Redesigning the `/profile` or `/connected-agents` route beyond any copy needed
  to keep entry labels consistent.
- Adding privacy policy, terms, support/contact, release-notes, or license pages;
  these remain sensible later About destinations once canonical URLs/content
  exist.
- Adding a new reusable row/card primitive solely for this screen. Reuse the
  current Settings row composition unless implementation proves an existing
  cross-screen abstraction is warranted.
- Broad product-brand spelling/capitalization cleanup outside touched copy.
- Deploying the Cloudflare authorization web or releasing a new mobile binary
  without separate operator authorization. Deployment order must put the
  public setup page live before a released mobile build links to it.

## UI Impact

- UI Impact?: `yes`
- Reuse `UiText`, `UiSurface`, `UiButton`, existing Settings pressable-row
  composition, `SyncStatusPanel`, and `uiColors` / `uiSpace` / `uiRadius` /
  `uiBorder` tokens.
- Do not introduce raw color literals in mobile screen/component files.
- Keep external-link and internal-navigation semantics distinct through visible
  wording, an external indicator, and accessibility roles/hints.
- UI docs updates are required because the Settings sections, user-visible
  states, and external transition contract change.

## UX Contract

### Key user flows

1. Flow name: Scan Settings
   - Trigger: user opens Settings from the shared bottom tray.
   - Steps: the screen shows a visible Settings title followed by Account, AI
     coaching, Preferences, Data & sync, About, and development-only tools in a
     predictable order.
   - Success outcome: account, coach connection, sync, and release information
     are distinguishable within one scan without changing existing destinations.
   - Failure/edge outcome: signed-out or auth-unconfigured states still render a
     useful Account destination; signed-in-only management and sync controls do
     not appear as usable when their prerequisites are absent.
2. Flow name: Identify the Installed Build
   - Trigger: user reaches the About section.
   - Steps: the app reads installed native version/build metadata, falling back
     to Expo config where appropriate, and reads the optional release codename.
   - Success outcome: the user can select/read `Version <version> (build
     <number>)`; a nonblank codename appears as `Release <codename>`; preview or
     local builds also identify their flavor.
   - Failure/edge outcome: unavailable values are omitted cleanly without empty
     labels, dangling parentheses, `undefined`, or a screen error. A missing
     codename is not shown.
3. Flow name: Learn How to Connect an AI Coach
   - Trigger: user taps `Connect an AI coach` in Settings.
   - Steps: the system browser opens the configured first-party `/connect` page;
     the page shows the MCP endpoint and explains how to begin authorization in
     an MCP client.
   - Success outcome: the user understands the next action, the read-only scope,
     and where access can later be revoked, without being shown an invalid OAuth
     request.
   - Failure/edge outcome: if the browser cannot be opened, Settings remains
     usable and shows concise inline retryable feedback near the action.
4. Flow name: Review Existing Agent Access
   - Trigger: signed-in user taps `Connected agents`.
   - Steps: the existing `/connected-agents` route opens and loads current OAuth
     grants.
   - Success outcome: the current review/revocation behavior is unchanged.
   - Failure/edge outcome: signed-out users do not receive a misleading grant
     management action; existing route-local load/revoke errors stay unchanged.
5. Flow name: Complete Real OAuth Consent
   - Trigger: an MCP client starts OAuth and sends the browser to
     `/oauth/consent?authorization_id=<valid-id>`.
   - Steps: the authorization web validates the request, signs the user in when
     needed, shows the requesting client and permissions, and approves or denies
     through the existing Supabase methods.
   - Success outcome: the valid client-initiated consent flow behaves exactly as
     before the setup-page addition.
   - Failure/edge outcome: missing, malformed, unknown, or unsupported consent
     state fails closed with the existing return-to-your-agent guidance.

### Interaction + appearance notes

- Keep the visible Settings title and section labels clear but compact; the
  screen remains vertically scrollable with no horizontal scrolling.
- Account and AI-coaching destinations remain full-width mobile tap targets.
- Mark the connect action as external visually and through
  `accessibilityRole="link"` plus an external-browser hint.
- Keep About visually quieter than actionable sections, with selectable release
  text suitable for support/debug conversations.
- Developer tools remain visually separated, development-only, and last.

## Acceptance criteria

1. Settings has a visible screen title and the agreed section order.
2. The Account row still routes to `/profile` and shows the signed-in email when
   available without exposing auth/session details.
3. `Connected agents` still routes to `/connected-agents` only for a signed-in
   user and retains existing grant/revocation behavior.
4. `Connect an AI coach` is visually and accessibly identified as an external
   link and opens the configured first-party `/connect` URL.
5. A rejected browser-launch promise produces inline, retryable feedback and no
   navigation or success claim.
6. The AI-coaching section states that access is read-only and revocable.
7. About uses `Application.nativeApplicationVersion` as the primary semantic
   version and falls back to `Constants.expoConfig.version` for development/test
   contexts.
8. About uses `Application.nativeBuildVersion` when nonblank and omits build
   punctuation cleanly when it is unavailable.
9. About reads `Constants.expoConfig.extra.releaseCodename`, shows a trimmed
   nonblank value, and omits the row when missing/blank.
10. Preview/local flavor is shown only outside the production build; no bundle
    identifier or internal credential/config value is displayed.
11. Mobile runtime metadata resolution is covered by focused tests for native
    values, Expo fallback, missing build number, optional codename, and flavor.
12. `/` and `/connect` on the authorization web render standalone connection
    guidance without attempting Supabase OAuth consent lookup or requesting the
    user's BoGa password.
13. The setup page displays the canonical public MCP endpoint, instructs the
    user to initiate Connect/Auth in the MCP client, explains read-only access,
    and names Settings -> Connected agents as the revocation path.
14. `/oauth/consent` without a valid `authorization_id` remains a fail-closed
    error, and a valid request still reaches the existing consent flow.
15. No mobile session, OAuth token, callback URL, user identifier, or secret is
    added to the connect URL, mobile config, web setup page, logs, or tests.
16. The layout remains usable on small and large iPhone simulator sizes with
    accessible tap targets, readable text, and no horizontal scrolling.
17. Mobile screen UI uses documented tokens/primitives/shared components; no raw
    mobile color literals are introduced.
18. Focused tests include at least one happy path and one failure/edge path for
    both the mobile Connect action and authorization-web route selection.
19. Visual evidence captures Settings with the new sections/About metadata and
    the standalone web setup page at a narrow viewport.
20. Relevant UI and authorization-web docs are updated in the same task.
21. Existing profile, Connected agents, sync status, preferences, and
    development-tool behavior remain green.
22. The public setup page is deployed and verified before any released mobile
    build points users to it; if deployment is not authorized in the
    implementation session, the completion note must record the operator owner
    and release-order dependency rather than claiming hosted success.

## Docs touched

- Planned docs/spec files to update:
  - `docs/specs/ui/screen-map.md` - describe the visible Settings heading,
    section order, dynamic account summary, coaching actions, About metadata,
    and browser-launch failure state.
  - `docs/specs/ui/navigation-contract.md` - record the external
    `/settings` -> first-party `/connect` browser transition while preserving
    the internal profile and Connected-agents transitions.
  - `docs/specs/ui/ux-rules.md` - record the app-specific distinction between
    external setup links and internal destination rows, including external-link
    affordance and inline launch failure.
  - `apps/agent-auth-web/README.md` - document `/`, `/connect`, and
    `/oauth/consent` responsibilities, the setup-page contract, hosted
    verification, and deployment ordering.
- Explicit no-update rationale:
  - `docs/specs/03-technical-architecture.md` - no expected update because the
    adopted OAuth/MCP boundary is unchanged.
  - `docs/specs/06-testing-strategy.md` - no expected update because no gate,
    lane, or coverage policy changes.
  - `docs/specs/08-ux-delivery-standard.md` - no expected update because this
    adds an app-specific Settings behavior, not a cross-task UX process rule.
  - `docs/specs/ui/components-catalog.md` - no expected update unless a reusable
    component is actually added or its role changes.
  - `docs/specs/09-project-structure.md` - no expected update because additions
    stay within existing canonical mobile/auth-web paths.
- UI docs update required?: `yes`, mapped to the canonical maintenance rules in
  `docs/specs/ui/README.md` as described above.
- Tokens/primitives compliance statement:
  - Reuse plan: existing Settings row composition, `UiText`, `UiSurface`,
    `UiButton`, `SyncStatusPanel`, and UI tokens.
  - Exceptions: the authorization web continues to use its existing scoped CSS
    design system; no mobile raw-literal exception is planned. Any new
    screen-local mobile styling must use shared tokens.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md`: `yes`.
  - Planned captures/artifacts: signed-in Settings showing Account, AI coaching,
    Preferences, Data & sync, About, and development tools where applicable;
    a narrow-viewport standalone `/connect` web page; an inline external-link
    failure state via component test or equivalent deterministic capture.
- UI docs remain synthetic/overview-first and source-linked; do not duplicate
  detailed props or implementation code.

## Testing and verification approach

- Before editing tests, read `apps/mobile/app/__tests__/README.md` as required by
  `AGENTS.md`. Read any additional nearest test-directory README before editing
  within that directory.
- Planned targeted checks:
  - Mobile metadata unit tests with mocked `expo-application`,
    `expo-constants`, and app flavor.
  - React Native Testing Library coverage in or beside the existing Settings
    route tests for section content/order, dynamic account copy, metadata,
    internal navigation, external-link success, and launch rejection.
  - Authorization-web unit coverage for pathname/request-state selection:
    standalone setup page, valid consent entry, missing/invalid consent ID, and
    preservation of the current authorization model tests.
  - `./boga test agent-auth-web` during focused iteration.
  - `npm --prefix apps/mobile run lint:ui-guardrails` after mobile UI styling
    changes; this check is standalone and is not included in the normal gates.
- Mandatory path-triggered gates:
  - `./boga test fast`
  - `./boga test frontend`
- Additional risk-based gate:
  - `./boga test mcp-smoke` because the authorization-web entry routing changes
    and the real client-initiated OAuth path must remain intact, even though the
    MCP service and backend contracts are out of scope.
- Before claiming any gate unavailable, run `./boga doctor` and resolve the
  bootstrap gap per `AGENTS.md`.
- Run `./boga test for --diff origin/main...HEAD` on the final diff and add any
  newly triggered gate before closeout.
- Test layers covered: pure unit, React Native component interaction,
  consent-web production build, real iOS simulator/Metro UI gates, and the real
  local OAuth-to-MCP smoke.
- Execution triggers: targeted tests during implementation; all mandatory and
  risk-based gates before PR/handoff.
- Slow-gate triggers:
  - Mobile route UI changes require `./boga test frontend`.
  - Consent entry-routing risk requires the focused `mcp-smoke` proof in this
    task even though `apps/agent-auth-web/**` normally triggers only `fast`.
- Hosted/deployed smoke ownership:
  - Deployment is not authorized by this planning request. After separate
    operator authorization, deploy `apps/agent-auth-web` before the mobile
    release and verify `GET /`, `GET /connect`, a real client-created consent
    request, approve, deny, refresh, and revoke behavior. Record operator and
    hosted evidence in the completion/release handoff.
- CI/manual posture note:
  - Infra-free mobile/consent tests run in CI through the fast lanes.
  - iOS Maestro and local-Supabase MCP smoke are local-only and must be run on
    this machine; CI green alone is insufficient.
- Never state a test duration unless it was measured by the gate records and
  read through `./boga timings`.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/settings.tsx`
  - `apps/mobile/app.config.ts` for public connect URL configuration only; do
    not alter native dependency/plugin fields.
  - A small mobile runtime metadata helper under `apps/mobile/src/utils/**`.
  - An agent-connect config/helper under an existing appropriate mobile
    `src/**` domain, if keeping this out of the route improves testability.
  - `apps/mobile/src/logging/record.ts` and its focused tests only if metadata
    resolution is centralized; log record shape and values must remain stable.
  - Existing Settings and new helper tests under
    `apps/mobile/app/__tests__/**`.
  - `apps/agent-auth-web/src/main.ts`, `src/authorization.ts` or a small pure
    route-selection module, `src/styles.css`, and focused tests.
  - The exact docs listed in `Docs touched`.
- Project structure impact: no new top-level paths or canonical directory
  conventions. Small files inside existing mobile/auth-web ownership areas do
  not require a project-structure update.
- Constraints/assumptions:
  - `expo-application`, `expo-constants`, and `expo-linking` are already mobile
    dependencies; do not add a native dependency for this task.
  - Prefer the platform-supported HTTPS opener already available through Expo or
    React Native; do not embed a web view for setup or consent.
  - Keep OAuth consent client-initiated and fail closed.
  - Keep the public setup URL configurable so a future first-party domain can
    replace the current Worker URL without screen logic changes.
  - Use user-facing `BoGa` capitalization in newly touched copy while avoiding a
    broad rename outside scope.
  - The setup page may show platform-neutral steps plus the currently supported
    client examples, but it must avoid copying long operational CLI/reference
    documentation into the UI.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate: `./boga test mcp-smoke`
- Additional UI guardrail: `npm --prefix apps/mobile run lint:ui-guardrails`
- Final trigger audit: `./boga test for --diff origin/main...HEAD`
- Closeout validation: run
  `./scripts/task-closeout-check.sh docs/tasks/T-20260911-01-improve-settings-and-mcp-onboarding.md`
  before moving the completed task card.

## Evidence

- Targeted test results:
  - Mobile Settings, public-connect configuration, runtime metadata, profile
    navigation, developer wipe, and logging metadata: 6 suites / 53 tests
    passed. The final fast gate below reran the complete final tree after the
    production-only metadata fallback case was added.
  - Authorization web: 3 files / 16 tests passed, including standalone setup,
    invalid consent, and valid consent entry states; production build passed.
- `./boga test fast`: passed on the final rebased implementation. Mobile lint
  completed with 0 errors (13 pre-existing warnings), typecheck passed, Jest
  passed 118 suites / 1144 tests / 1 snapshot, and backend-fast, docs-check,
  meta-tests, authorization-web, and MCP-unit lanes all passed.
- `./boga test frontend`: passed on the final rebased implementation across
  `ios-smoke`, `ios-data-smoke`, `ios-auth-profile`, and `ios-sync-e2e`.
  Artifact roots:
  - `apps/mobile/artifacts/maestro/ad-hoc/20260911-131144-68530`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260911-131930-69688`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260911-132054-71142`
  - `apps/mobile/artifacts/maestro/ad-hoc/20260911-132242-72659`
  - The same final auth/profile flow also passed on a dedicated iPhone SE (3rd
    generation) simulator; its retained artifact root is
    `apps/mobile/artifacts/maestro/ad-hoc/20260911-121056-39638`. The temporary
    simulator was deleted after its clean run and the worktree's registered
    simulator configuration was restored.
- `./boga test mcp-smoke`: passed; the real local client discovered and called
  all four read-only tools through the agent API.
- `npm --prefix apps/mobile run lint:ui-guardrails`: passed, 31 files scanned and
  0 raw-color violations.
- Final `./boga test for --diff origin/main...HEAD`: passed on the committed,
  rebased 22-path diff and required the union `fast`, `frontend`, `docs-check`,
  and `meta-tests`; all are green (`docs-check` and `meta-tests` ran within
  `fast`).
- UI/UX visual artifacts:
  - Settings section hierarchy:
    `apps/mobile/artifacts/maestro/ad-hoc/20260911-122142-48301/maestro-output/screenshots/06-settings-sections-top.png`
  - Settings Data & sync/About/release metadata:
    `apps/mobile/artifacts/maestro/ad-hoc/20260911-122142-48301/maestro-output/screenshots/07-settings-about-metadata.png`
  - Equivalent small-iPhone captures are under
    `apps/mobile/artifacts/maestro/ad-hoc/20260911-121056-39638/maestro-output/screenshots/`.
    Both large- and small-iPhone captures were visually inspected: content is
    readable, full-width cards do not clip horizontally, and the intended
    section order is preserved while scrolling.
  - The standalone setup page was rendered from the local Vite production code
    and inspected through a browser-emulated 320 x 844 CSS viewport. The full
    instructions and wrapped MCP endpoint remained readable, measured content
    width equaled viewport width (no horizontal overflow), and the browser
    console had no warnings or errors.
- UX Contract traceability:
  - Scan Settings: implemented by the ordered section containers and covered by
    `settings-onboarding.test.tsx` plus both Settings screenshots.
  - Identify the installed build: implemented by `runtime-metadata.ts`, covered
    by native/fallback/missing/production/flavor unit cases, and shown in the
    About screenshot.
  - Learn how to connect: implemented by the safe configured external-link
    helper and standalone web route; covered by link success/rejection,
    configuration-safety, route-selection, and narrow-browser checks.
  - Review access: the signed-in-only `/connected-agents` route remains covered
    by Settings tests and the real `ios-auth-profile` flow.
  - Complete consent: `/oauth/consent` still validates client-created state and
    is covered by route/main tests plus the real `mcp-smoke` OAuth path.
- Manual verification summary (required when CI is absent/partial): local iOS
  simulator/Metro UI lanes and the local Supabase-backed MCP smoke passed on
  this machine. After operator `sboschi` deployed the authorization web, the
  hosted `/connect` route rendered the new setup UI and served
  `index-Bp2KSzpf.js`, matching the local production bundle. Hosted
  `/oauth/consent` without authorization state failed closed, an unknown route
  rendered the unsupported-page state, the Render MCP health endpoint returned
  HTTP 200, an unauthenticated MCP initialize returned the expected OAuth HTTP
  401 challenge, and the protected-resource, authorization-server, and
  Supabase Auth health endpoints all returned HTTP 200.
- Deferred/manual hosted checks summary: the deployment and read-only hosted
  smoke are complete. A production-account approve/deny/refresh/revoke
  lifecycle remains an operator test because it creates OAuth state and grants;
  the equivalent real client-created lifecycle passed locally in `mcp-smoke`.

## Completion note

- What changed: Settings now has the requested ordered sections, dynamic Account
  and installed-release context, safe external AI-coach setup entry, preserved
  Connected agents/sync/developer behavior, and signed-out guidance. The
  authorization web now separates public setup routes from fail-closed OAuth
  consent routing, with corresponding tests, docs, and simulator coverage.
- What tests ran: focused mobile and web suites; final `fast`, `frontend`, and
  `mcp-smoke` gates; standalone mobile UI guardrails; final committed-diff and
  full working-tree trigger audits; visual inspection of final iOS captures and
  the narrow setup page.
- What remains: optionally run the production-account
  approve/deny/refresh/revoke lifecycle before a wider release. No change was
  required to the architecture, testing-strategy, UX-process,
  components-catalog, or project-structure specs because implementation stayed
  within the task's planned routes, helpers, and existing UI primitives.

## Status update checklist

- Update `Status` and frontmatter `status` to `completed`, `blocked`, or
  `outdated`.
- If completed or outdated, move this file to `docs/tasks/complete/` in the same
  session and update affected references.
- Fill Evidence and Completion note before handoff.
- Update the required UI/authorization-web docs and keep them
  synthetic/overview-first.
- Confirm no project-level architecture/testing/project-structure docs require
  an update; add one if the actual implementation expands beyond the planned
  boundary.
- Parent milestone status update: N/A because this is a standalone post-M21 MVP
  task and M21 remains complete.
- Run the task closeout checker before handoff.
