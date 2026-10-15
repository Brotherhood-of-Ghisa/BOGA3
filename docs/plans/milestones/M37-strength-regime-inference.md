# M37 — Strength-regime inference and experimental chart mode

- Status: `in_progress`
- Created: 2026-10-15, experimental baseline `4a8bdae67ba5e749098d5bae867e4cc7c0184173` on `m36-t09-rm-analytics-entry`.
- Tracking: repository milestone/cards only; no GitHub milestone or issues.
- Authorization: owner approved the proposed plan and requested implementation. Continue the experimental stack; main stays untouched and PRs stay draft/unmerged. This follow-up does not reopen M36's descriptive first release.

## Objective and scope

Connect the conditional RIR/load likelihood to a one-break strength model, measure its reliability, and then expose a reviewed experimental Strength regimes mode. Only total 1RM changes the adopted RM curve's amplitude. Preserve all logged metrics, loading semantics and the existing historical-reference chart.

In: segmented likelihood fitting, fixed/shared joint uncertainty, gradual no-break competitors, unknown session boundaries, empirical/synthetic reliability, an assessment contract and a gated two-curve mode. Out: multiple breaks, slope-change alternatives, posterior break probabilities, confirmed physiological diagnoses, alerts, new server/schema/sync behavior and automatic production activation.

## Agreed direction

### D1. Conditional likelihood and shared nuisance parameters

Logged RIR 0 is exact. Positive logged n permits actual n−1/n/n+1 with probabilities (1−p)/2,p,(1−p)/2. Fixed fitting uses p=0.50 and total-load SD2.50 kg; joint fitting estimates p and load SD shared across regimes. Per-side entry SD1.25 kg scales once. Keep the adopted kernel and load/bodyweight semantics; no second formula or latent-RIR prior factor.

### D2. Strength models and session units

Compare constant and gradual no-break trajectories with one abrupt level change, estimating older/newer S and a cut between complete sessions. Start with eight independent sampled sessions per side as a search constraint, not a sufficiency guarantee. Reuse prespecified first-working-ordinal sampling without substituting later effort. All qualifying chart observations remain displayed. Noise-only changes, trends and dependence must be tested as competing explanations.

### D3. Validation gates UI integration

T01 ends with independently reviewed fitting and diagnostics. T02 ends with measured reliability and a concrete assessment/adequacy/evidence-emphasis contract; human analytical review accepts it before UI inference integration. Failed reliability is recorded and revised, not hidden. The 5% no-break calibration reference is not a visibility threshold or posterior probability. Keep the single current-model research paper updated in place; Git retains iterations.

### D4. Approved UI choices

Separate Reference / Strength regimes modes on the same screen; Reference stays default. Strength regimes exposes Fixed / Joint, initially Fixed. Shared uncertainty applies to both regimes. Once both fits are estimable, show a labelled tentative candidate even at weak evidence; monotonically increase emphasis using validated evidence with readable minimum contrast. No confirmed-break or point-membership assertion follows. A missing historical reference never triggers an automatic regime-fit fallback.

### D5. Design, checks and experimental delivery

Reuse the approved two-curve concept, but pin and obtain human approval of the updated selectors, numerical readouts and loading/insufficient/error states before significant UI implementation or acceptance testing. Keep analysis derived, cancellable and scoped to one current input snapshot. Reject stale results. Each card has a separate worktree/PR based on its reviewed parent; no main merge is implied. Before execution, agree lanes beyond fast; retain the session's research fast/coverage/complexity/dependencies/docs-check set. UI additionally requires an agreed focused native scenario after design approval.

## Task breakdown

| Task | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| M37-T01 | Direct segmented likelihood, smooth competitors and numerical diagnostics | reviewed M36 experimental baseline | completed |
| [M37-T02](../tasks/M37-T02-Regime_reliability_and_contract.md) | Reliability, adequacy and evidence contract; human analytical gate | T01 | in_progress |
| [M37-T03](../tasks/M37-T03-Experimental_strength_regimes_UI.md) | Approved experimental mode, fixed/joint selector and tentative curves | T02 + human analytical/design gates | planned |

## Definition of Done and limitations

All three deliverables independently reviewed; current paper and durable owning contracts agree with code; agreed gates green; UI shows supported and abstention states honestly. Production activation remains a separate owner decision. Sparse authorized Zercher Squat/Dumbbell Bench Press histories may not support two regimes. Unknown effort, noise shifts, serial dependence, repeated looks and weak nuisance identification can prevent a reliable assertion. Never call the search minimum a validated data threshold or a likelihood score a break probability.
