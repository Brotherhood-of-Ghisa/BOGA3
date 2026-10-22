import { Information } from '@/components/ui';

const SECTIONS = [
  ['Reading the chart', 'Each dot is a working set. Up means more load; right means more reps. RIR means reps you felt you had left: eight reps with two left is plotted at ten. Per side means one side. On bodyweight exercises, Load can include part of your bodyweight.'],
  ['The soft halo', 'A wider halo means more uncertainty about reps left; a taller one means more everyday load variation. Parsimonious uses fixed errors. Rich uses errors estimated from your history, once the fit is ready. RIR 0 has no sideways spread. Halos show modelled variation, not a confidence level or uncertainty about the weight you logged.'],
  ['Gym, time and effort', 'These filters decide which sets count. All gyms pools their histories, even when equipment differs. All known RIR uses sets with a recorded estimate of reps left. The time filter narrows the dates.'],
  ['One curve / Two curves', 'One curve treats the selected history as one strength level. Two curves looks for an earlier and a later level, and a possible date between them.'],
  ['Parsimonious / Rich', 'Parsimonious uses fixed assumptions about everyday variation and RIR guesswork. Rich tries to learn that variation from your history too. It can need more data; it is not automatically more reliable.'],
  ['1RM and fitting sessions', 'The curve’s 1RM is its estimate of the load for one all-out rep. To draw the line, each completed workout supplies its set with the highest estimated 1RM. Fitting sessions counts those workouts; the dots show all matching sets.'],
  ['Exploratory fit', 'This is a pattern to explore, not proof that your strength changed. Tap a dot to inspect the set behind it.'],
] as const;

/** Help is requested explicitly; opening or dismissing it never changes chart scope. */
export function RmCurveHelp() {
  return <Information label="RM curve" title="About the RM curve" testIDPrefix="rm-curve"
    body="Heavy weights usually mean fewer reps. The curve uses your past sets to estimate that trade-off for this exercise. It can also look for a possible change in strength over time."
    sections={SECTIONS} />;
}
