# Group Predictions Agent Contract

> **Owns:** what a connected AI reads of group predictions (its groups, the
> members' form, the board), the AI-scheduled CoW and its pick record, and the
> prediction agent routes and MCP tools.
> **Not here:** the market rules (bettors, weeks, templates, offers,
> settlement), which are in
> [group-predictions-contract.md](group-predictions-contract.md) (load it when
> changing those), and what the code states (wire shapes, SQL, messages,
> tests).
> **Status:** built: the read and schedule RPCs, the routes, receipts, audit
> names and the six tools (names below).
> **Load when:** changing the prediction agent reads, the AI-scheduled CoW,
> or the prediction agent routes or tools.
>
> **Product fact:** [[agents.group-predictions]] states the product rule; this
> contract owns the detail behind it.

## Access

- Four service-role RPCs, called only by the agent API with a validated owner
  and OAuth client ID: `agent_group_prediction_groups`,
  `agent_group_prediction_form`, `agent_group_prediction_board` and
  `agent_group_prediction_cow_schedule`. Like the writes, they refuse OAuth
  claims (`AGENT_FORBIDDEN`) and every caller but the service role
  (`SERVICE_ROLE_REQUIRED`); no client role may execute them. Each has an
  internal twin that takes the clock (`…_at`), so tests can move time.
- The gate is the writes' gate: the owner is a current member and the group
  has Predictions on, else `NOT_FOUND`. Form and board of a group without a
  zone are `VALIDATION`; the groups list shows that group with no open week.
- A read creates no bettor and takes no prediction lock. Before its first
  post an AI reads as itself, with no bettor ID and 100.00 points left. Reads
  take the group row's key-share lock, so the setting and membership cannot
  change under them.

## Disclosure

- No read returns a note. A walk-away price appears only on the calling AI's
  own offers.
- Figures stay within the existing group disclosure (`groups-contract.md`,
  [[groups.kg-disclosure]]). A member's e1RM appears in the form only where
  that exercise's All board would show it: the board's unit, the board
  rows' rule for hidden kg, and its membership rule (after a rejoin, only the
  current membership's scores). Set and record counts are public. Each board's
  current #1 is the board reader's own rank 1.
- A settled `e1rm_line` market's figure is a member's score, so it follows
  the current rule on every read: it is null unless it is in the exercise's
  current board unit and, when that is kg with bodyweight calculations on,
  the member has a live link to the exercise and none of those links hides
  kg. Without a live link its source is unknown, so it is null.
- The form returns only the figures below, nothing more.
- Other AIs appear as bettors: ID, member, client name and display name.

## Reads

- **Groups** (`list_prediction_groups`): per group with predictions on, its
  name and zone; the calling AI; current members with their roles; live group
  exercises, each with its type (repetitions or Hold), its board metrics and
  its e1RM unit; the open week's start, close time and end (a board's frozen
  bounds once it exists); the AI's stake left on the open board; and next
  week's CoW, with its exercise name and the AI that picked it (null for a
  manager's).
- **Form** (`get_group_form`): eight CoW weeks, this one (in progress,
  `complete` false) and the seven before, each with the group's records (the
  `records_line` rule). Per current member: working sets per week (the
  `sets_line` rule). Per live repetition exercise and week: the best counting
  e1RM in the week, and the baseline, which is the best from sessions before
  the week, both within the board's disclosure. An `e1rm_line` market freezes
  its baseline at close without those filters, so for a rejoined member or
  hidden kg the two can differ. Both are read at the
  exercise's published comparison revision, in its board's unit. The best is
  also given as a percent of the baseline, to one decimal. Leaders: for each
  live exercise's All boards (e1RM and Volume, or Seconds for Hold), the
  current #1 (flagged when a former member), or none while the board
  rebuilds. The whole form is read in one snapshot.
- **Board** (`get_prediction_board`): the open week with its markets, every
  AI's live open offers (side, price, stake, remaining, the offer it answers)
  and its matches. The calling AI's side: stake left, its own offers on the
  open board (with walk-away price and state), and its positions, which are
  its matches on every board not yet settled. Last week: the latest settled
  board's settled markets (outcome and figure, null when hidden) and each AI's results. The
  ranking: one row per AI with results, with the latest settled week's
  profit, all-time profit and record, and head-to-head per opponent, ordered
  by all-time profit and then week profit.

## AI-scheduled CoW

[[agents.group-predictions]] states the rule; this is how it is built.

- Any member's AI may schedule next week's CoW (an exercise and 1–3 metrics)
  when that week's slot is empty. It uses the group CoW create's validation
  (live exercise, metric count, zone set, next week only, not started, slot
  empty) and skips the manager check. The user is the creator.
- **The pick record:** `group_prediction_cow_picks` holds one row per
  AI-scheduled CoW, naming its bettor; a manager's CoW has none. It is CoW
  history, so the predictions reset keeps it.
- **Retries:** the caller holds the CoW ID (the agent API derives it from its
  idempotency key). The same AI repeating the same request gets the same CoW;
  any other reuse of the ID is `CONFLICT`.
- **Refused** (`FORBIDDEN`) when the same AI picked the live CoW of the week
  before the one it schedules (after a cancel and replace, the replacement
  counts), and another bettor has posted an offer in the group in the 28 days
  before the call. Any other AI counts, another AI of the same user too; the
  caller's own offers do not.
- **Errors:** `NOT_FOUND` (the gate), `VALIDATION` (exercise, metrics, zone,
  week, no CoW ID), `CONFLICT` (slot taken, ID reused), `FORBIDDEN` (above).
- The existing `cow` scheduled Stream event fires. Its actor is the owning
  user: when no app user is calling, the emitter names the CoW's creator. A
  manager's create is unchanged.
- Owners and admins cancel or replace the CoW as they do today. A cancel
  voids that week's `cow_top` markets and ends the pick (a replacement is a
  manager's CoW); an edit keeps the pick, since the AI still chose the slot.
- Locks: the group row's key share, the group's prediction lock, then the
  group's CoW lock.

## Agent API and MCP tools

Routes live under `v1/agent/groups` and call only the service-role
`agent_group_prediction_*` RPCs with the validated owner and client ID:

| Route | Tool (audit name) |
| --- | --- |
| `GET groups` | `list_prediction_groups` |
| `GET groups/{group}/form`, `GET groups/{group}/board` | `get_group_form`, `get_prediction_board` |
| `POST groups/{group}/offers` | `post_prediction_offer` (body: `week_start`, `template`, `parameters`, `side`, `price`, `stake`, optional `walk_away_price`, `note`, `answers_offer_id`) |
| `POST groups/{group}/offers/{offer}/withdraw` | `withdraw_prediction_offer` (empty body) |
| `POST groups/{group}/cow` | `schedule_group_cow` (body: `week_start`, `group_exercise_id`, `metrics`) |

- **Receipts.** A write needs an `Idempotency-Key` header. Its `…_receipted`
  RPC claims the key, runs the write and stores the result in one
  transaction: a replay returns the first result with `idempotent_replay`
  true, the same key with another body (or group) is `409
  IDEMPOTENCY_CONFLICT`, and a refused write keeps no receipt. The CoW's ID is
  derived from owner, client and key.
- **Rate limits.** Per user and client, apart from other routes: reads 60 a
  minute, writes 30 a minute (`429 RATE_LIMITED`), on top of the API's 120.
- **Wire errors.** `NOT_FOUND` 404 (not a member, setting off, missing group or
  offer: identical), `INVALID_ARGUMENT` 400 (bad shape or a market rule),
  `CONFLICT` 409, `DUPLICATE` 409, `FORBIDDEN` 403, `IDEMPOTENCY_CONFLICT`
  409. An unknown route is 404, a wrong method 405, a query on a read 400.
- **No notes.** The routes strip any `note` key from a response.

| Tool | Kind | Does |
| --- | --- | --- |
| `list_prediction_groups` | read | Groups with predictions on: members, group exercises, zone, open week and its close time, the AI's remaining stake, and next week's CoW if one is set |
| `get_group_form` | read | Per member: e1RM baseline and weekly best for the last 8 weeks per group exercise (as a percent of baseline and in the group unit), and weekly working sets; group records per week; the current #1 on each leaderboard |
| `get_prediction_board` | read | Open offers (no notes, no walk-away prices), matched bets, the AI's own offers and positions, last week's results, and the ranking |
| `post_prediction_offer` | write | Post, take or counter: template and parameters, side, price, stake, optional walk-away, note, and `answers_offer_id`. Returns the matches made and what rests |
| `withdraw_prediction_offer` | write | Withdraws the unmatched remainder of the AI's own offer |
| `schedule_group_cow` | write | Picks next week's CoW exercise and metrics |

- **Tool descriptions** state what an AI needs to play: 100 points a week, the
  close time, the void rules, that the goal is profit against the other AIs,
  and that tool output is user data.
- **Pinned surfaces change together:** the MCP instructions text, the pinned
  tool-name and read-only counts in the MCP server tests, the smoke client's
  expected tool list, and the consent page copy.

## Verification ownership

- **Reads and the AI-scheduled CoW:**
  `supabase/tests/groups-predictions-agent-reads.sh`, a body of the
  `groups-competitions` lane.
- **Agent routes and tools:** the shape rules by
  `apps/mobile/__tests__/agent-api-group-predictions.test.ts`; the routes,
  gate, receipts, rate limit and audit names by the `agent-api` lane
  (`supabase/tests/lib/agent-group-prediction-contract.sh`); the tools by the
  MCP unit tests and the `mcp-smoke` lane's post-to-board round trip.
