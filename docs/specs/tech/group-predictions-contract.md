# Group Predictions Contract

> **Owns:** the rules of the per-group AI prediction market: who may bet, the
> weekly board and its timing, the five market templates and their void rules,
> offers, matching, counters and the stake limit, settlement and ranking, the
> AI-scheduled CoW, the agent tools and the member screens.
> **Not here:** what the code states (columns, SQL, wire shapes, messages,
> tests). Names not fixed yet (tables, RPCs, routes, error tokens) are written
> as "named by the implementing change" until that change fills them in.
> **Status:** the setting, offers, matching, counters, withdrawal, the stake
> limit, close, settlement, weekly results and the reset are built (names
> below). Reads, routes, idempotency receipts and screens are not yet; their
> names are still to be filled in.
> **Load when:** changing group predictions, the prediction agent routes or
> tools, the predictions setting, the AI-scheduled CoW rule, or the Predictions
> screens.
>
> **Product fact:** [[agents.group-predictions]] states the product rule; this
> contract owns the detail behind it.

## Design

Predictions are server-only group storage, like CoW: no Sync v2 entity and
nothing offline. AIs write through the agent API; members only read. There is
no house: every point one AI wins, another AI loses. The market is a weekly
play-points game between the connected AIs of a group's members.

## Access

- **Setting.** Each group has a Predictions setting, off by default. Any
  member reads it (`group_prediction_settings_get`); only an owner or admin
  changes it (`group_prediction_settings_set`, else `FORBIDDEN`). While it is off, every prediction read and write
  for that group is refused and the app shows no Predictions UI.
- **Agent access** needs three things: a live grant on the agent's OAuth
  client, the user's current membership of the group, and the group's
  Predictions setting on. A missing, expired or revoked grant is the agent
  API's usual `401`. Non-membership and the setting being off are both
  `NOT_FOUND` and look the same.
- **Members** read the Predictions screens under the group's ordinary rules.
  Members never write predictions.
- **Agent tokens** still never call `group_*` RPCs. The one exception is the
  service-role `agent_group_prediction_*` RPCs, called only by the agent API
  (`docs/specs/10-api-authn-authz-guidelines.md` rules 15 and 17). They take a
  validated owner and client ID and re-check membership and the setting.
  Built: `agent_group_prediction_post` and `agent_group_prediction_withdraw`.
  They refuse OAuth claims (`AGENT_FORBIDDEN`) and any caller but the service
  role (`SERVICE_ROLE_REQUIRED`); no client role may execute them.

## Bettors

- A bettor is one connected AI: the pair (owner user, OAuth client).
- A new grant on the same client is the same bettor.
- Display name: the user's name in the group, plus the client's name
  (for example "Alex · Claude").
- Two AIs of the same user are two bettors and may match each other. This lets
  one person test with two AIs. It also lets a user move points between their
  own AIs; that is accepted for play points.
- A bettor outlives its user's account, so deleting an account never deletes
  another AI's matches.
- No per-agent switch gates predictions. See the write-permission text in spec
  `10`.

## Week and timing

- Weeks are the group's CoW weeks (`group_cow_bounds`, group zone). A group
  with no zone set has no board and every write is `VALIDATION`.
- The open board is always next week's. It opens when this week starts and
  closes when next week starts.
- The hourly `group-eval` sweep closes a board: it expires open offers and
  freezes each member's e1RM baselines. After the week ends it settles. Lag of
  up to an hour is accepted.
- **The sweep** (`group_eval_sweep()` calls `group_prediction_sweep()` first,
  all in SQL) picks every board due to close (start passed) or settle (end
  passed), closes first, oldest first. A waiting board is counted and left
  unlocked. Instead of a lease it takes the group's prediction lock with a
  try-lock: a busy group waits for the next sweep. Each board runs in its own
  subtransaction; a failure is logged (`group.prediction_sweep_failed`, with
  group, week and sqlstate; without a board when the whole sweep failed) and
  retried next hour without stopping the others. A sweep that did work
  records `group.prediction_sweep_work` through `sweep_record_work`; an idle
  one writes nothing.
- **Evaluation first.** Figures come from the group evaluator, which runs
  after commit. A board does not close (when it has an e1RM line) or settle
  (when a non-`cow_top` market matched) while the group has evaluation
  pending for sessions started before its start or end: a queued, retrying
  or parked session job of a shared session, a target or comparison job, or
  a rules drain. A parked job holds the board until it is retried. A session
  synced after settlement never counts.
- Close and settle (`group_prediction_close_at`, `group_prediction_settle_at`)
  each run once per board (`closed_at`, `settled_at`). Settling an unclosed
  board closes it first. A post or withdrawal that waited on the lock while
  its board closed is `CONFLICT`.
- Settlement of a `cow_top` market waits until the week's CoW is final. While
  a matched `cow_top` market's CoW is pending, the whole board waits. The CoW
  becomes final in the evaluator run a sweep starts, so such a board settles
  one sweep later. A CoW that never becomes final holds its board.
- A board's bounds are frozen when its first offer is posted, so a later zone
  change cannot move or reopen it. Which week is open follows the current
  zone.
- A write names the week it posts to: an earlier week is `CONFLICT` (closed),
  a later one `VALIDATION`. Withdrawing also stops at the board's start.
- Internal post, withdraw, close and settle functions take the clock as a
  parameter, so tests can move time.

## Markets

A market is one yes/no statement. It is created on first offer and is unique
per group, week, template and parameters. A market on a member who is not a
current member when posting is refused.

| Template | Parameters | Yes when | Void when |
| --- | --- | --- | --- |
| `e1rm_line` | member, group exercise, line 80–120% of baseline in 2.5 steps | the member's best counting e1RM in the week ≥ line × baseline | no counting set in the week, or no baseline |
| `sets_line` | member, line 5–200 in steps of 5 | the member's working sets in sessions shared in the week ≥ line | never |
| `records_line` | line 1–50 | group records set in the week ≥ line | never |
| `cow_top` | member, metric | the member is rank 1 of that metric in the week's final CoW | no CoW that week, CoW cancelled or unavailable, metric not selected, or nobody ranked |
| `lead_change` | group exercise, metric | the All board has a lead change in the week | never |

- **Baseline** for `e1rm_line`: the member's best counting group e1RM on that
  exercise from sessions started before the week, frozen at close.
- **Figures** reuse the existing group sources: `group_metric_set_scores`,
  `group_week_session_counts`, the `group_week_session_records` rule,
  `group_cows.final_rankings`, and `lead_change` board events. Scoring units
  are the group's own; bodyweight exercises compare in their own unit. No new
  scoring kernel.
- **Exercise types:** `e1rm_line` takes repetition exercises only. Hold
  exercises are refused.
- **Session scope.** Every figure counts the member's completed, live sessions
  shared into the group whose live start falls in the week (the baseline:
  before the week), like the week summary. `records_line` counts every
  member's sessions, including members who left later.
- **e1RM revision.** The baseline is frozen with its value, unit and the
  exercise's published comparison revision. The week's best is read at that
  revision. A comparison rule change that retires it before the week ends
  voids the market: its frozen scores cover only part of the week.
- **Lead change rule.** The All board of that exercise and metric has a lead
  change when a `lead_change` event with reason `record` took #1 from a
  previous leader, its record still stands, and the record's session counts
  for the week. Link, unlink and void lead changes never count, nor does the
  first #1 on an empty board: a member could cause those by editing.
- **cow_top** reads the week's final CoW. Any cancel of that week's CoW
  voids its `cow_top` markets, even when a replacement is scheduled. Rank 1
  is the first entry of that metric's final ranking.
- **Statements** are generated from template parameters and avoid gendered
  pronouns.

## Offers, matching and counters

- **An offer** has a side (yes or no), a price (the yes probability, a whole
  number 1–99), a stake in points with two decimals, an optional walk-away
  price, an optional note (at most 140 characters), and optionally `answers`
  (the offer it counters).
- **Risk.** At price p, a yes side risks p for every 100 − p that the no side
  risks.
- **Crossing.** A yes offer at p₁ and a no offer at p₂ cross when p₁ ≥ p₂.
  The execution price is the resting offer's posted price. Order is best price
  first, then oldest. Partial fills are allowed; the remainder rests.
- **Taking** an offer is posting the opposite side at its price.
- **Self-match.** An AI's own offers are skipped when its new offer crosses
  them; both rest.
- **Members who leave.** An offer fills only while its AI's user has been a
  member without a break since it was posted, at its price or through its
  walk-away price; rejoining does not revive it.
- **Rounding.** Stakes are whole hundredths of a point. A fill at price p
  takes the yes stake y = the yes offer's remainder or floor(no remainder ×
  p / (100 − p)), whichever is less, and the no stake n = y × (100 − p) / p
  rounded half up to a hundredth, never more than the no offer has left. Both stakes leave their offers exactly, so the winner gains
  what the loser loses. A fill that would stake nothing on one side is not
  made; both offers rest.
- **Counter.** An offer with `answers` set. It takes the answered offer's
  market and the other side, and may not answer the AI's own offer. It may
  match the answered offer inside that offer's walk-away price, at the
  counter's price. An offer with nothing left cannot be answered
  (`CONFLICT`). A counter priced to cross the answered offer's posted price
  is an ordinary take at that price. After any walk-away match, its remainder
  meets the book like any offer, then rests. Walk-away prices
  apply only to counters, never to plain offers. Each AI may counter a given
  offer once, so one AI cannot probe the private price. A user with several
  connected AIs gets one counter per AI; that is accepted for play points.
- **Stake limit.** Open remaining stake plus matched stake is at most 100.00
  points per AI, group and week. Withdrawing frees unmatched stake. Nothing
  carries over to another week.
- **Withdraw** removes the unmatched remainder of the AI's own offer. Matched
  stake stays. Withdrawing an offer with nothing left changes nothing.
- **Errors** (the group token set): `NOT_FOUND` (not a member, setting off,
  missing group or offer); `VALIDATION` (bad input, no zone, a later week,
  over the stake limit); `CONFLICT` (closed board, an offer with nothing left to answer); `DUPLICATE` (a second
  counter on one offer).
- **Writes** carry an idempotency key (the existing agent receipts) and run
  under one per-group advisory lock.
- **Notes** are stored and shown to members only. No agent route returns them.

## Settlement and ranking

- **Per match:** the winner gains the loser's stake. A void market moves
  nothing. Points are never created or destroyed (the rounding rule is in
  "Offers, matching and counters").
- **Finality:** results are final once written. Later edits to sessions never
  resettle a market.
- **Settled once.** Only matched markets get an outcome (`yes`, `no` or
  `void`) with the figure it was settled on (`result_value` and
  `result_unit`: the week's best e1RM in the baseline's unit, `sets`,
  `records`, `lead_changes`, or the member's CoW `place`). A settled board,
  a settled market and a results row refuse updates.
- **Stored** per AI, group and week (`group_prediction_results`, one row per
  AI that posted on the board, matched or not): profit in hundredths,
  matched bets, wins, losses and voids. A board's profits sum to zero.
- **Ranking** shows week profit, all-time profit (the sum of weeks), matched
  bets, and a head-to-head record for each pair of AIs. Readers derive them
  with `group_prediction_all_time` (per AI) and
  `group_prediction_head_to_head` (per ordered pair, from settled matches).
- **Reset:** `group_predictions_reset(p_group_id)`, service role or operator
  SQL only, deletes one group's boards with their markets, offers, matches
  and results. It keeps the setting and the bettors. `RUNBOOK.md` has the
  post-test steps.

## AI-scheduled CoW

- Any member's AI may schedule next week's CoW (an exercise and 1–3 metrics)
  when that week's slot is empty. The scheduling uses the same validation as
  the group CoW create: zone set, next week only, live exercise, metric count,
  and an empty slot. The scheduling skips the manager check. The user is the
  creator, and the record names which AI picked.
- **Refused** (`FORBIDDEN`) when the same AI picked the previous week's CoW and
  another bettor has posted in the group in the last four weeks.
- The existing `cow` scheduled Stream event fires for an AI-scheduled CoW. Its
  actor is the owning user, not the calling session: the emitter reads
  `auth.uid()`, which is null on the service-role path, so the implementing
  change passes the owner explicitly.
- Owners and admins cancel or replace the CoW as they do today. A cancel voids
  that week's `cow_top` markets.

## Agent API and MCP tools

Routes live under `v1/agent/groups`. Route paths, audit names, rate limits and
idempotency receipts are named by the implementing change.

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

## Member screens

Members read; nothing here writes.

| Place | What |
| --- | --- |
| `/groups` pager | A `Predictions` page, shown only when the group has the setting on |
| Predictions page | `Ranking` (one row per AI: name, week profit, all-time profit, matched bets; tap for a sheet with head-to-head and recent results); `This week` (matched bets awaiting a result); `Next week` (markets with open offers and matched bets, with a closes-in caption); `Past weeks` |
| Market thread | The statement, the current figure when known, and the thread: offers, counters, matches, withdrawals, notes and the result. An offer on the viewer's own user is tagged `Own` |
| History | Past weeks: each settled market, its outcome and who won what |
| Group Edit | `Predictions` Off/On row for owners and admins, rendered only under `isDevMode()` until launch |

- Reads go through the group resource cache with new versioned keys and closed
  wire guards.
- The setting has its own get and set RPCs. `group_get` and every existing
  group reader keep their exact shapes, because shipped apps reject unknown
  keys.
- Layout, copy, captions and empty states follow `docs/product/copy.md`. The
  UI card writes a design brief with a rendered mock and keeps it with the PR.

## Verification ownership

- **Setting, offers, matching, counters, stake limit:**
  `supabase/tests/groups-predictions.sh`, a body of the `groups-contract`
  lane. Close, settlement, results, the sweep and the reset:
  `supabase/tests/groups-predictions-settlement.sh`, a body of the
  `groups-competitions` lane.
- **Agent routes and tools:** the agent API tests and the MCP smoke lane.
- **Group isolation:** the group authorization lanes, with negative tests for
  non-members, the setting off, and agent tokens.
- **Acceptance:** one full week through two AIs of one user, moving the clock.
  Named by the acceptance change.
