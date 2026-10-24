import { useState } from 'react';

import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { ProgressBreakdown, ProgressExerciseMetric, ProgressMetric, ProgressPeriod } from '@/src/preferences/model';

export type { ProgressPeriod } from '@/src/preferences/model';

export type ProgressFilterParams = {
  breakdown?: string | string[];
  period?: string | string[];
};

export type ProgressFilters = {
  breakdown: ProgressBreakdown;
  period: ProgressPeriod;
  metric: ProgressMetric;
  /** The Exercise table's metric, which may be one the Muscle table cannot show. */
  exerciseMetric: ProgressExerciseMetric;
  /** Secondary work in muscle figures ([[muscle.secondary-filter]]). */
  countSecondary: boolean;
  selectBreakdown: (next: ProgressBreakdown) => void;
  selectPeriod: (next: ProgressPeriod) => void;
  selectMetric: (next: ProgressMetric) => void;
  selectExerciseMetric: (next: ProgressExerciseMetric) => void;
  selectCountSecondary: (next: boolean) => void;
};

type Choices = {
  breakdown?: ProgressBreakdown; period?: ProgressPeriod; metric?: ProgressMetric;
  exerciseMetric?: ProgressExerciseMetric; countSecondary?: boolean;
};
type Defaults = Required<Choices>;

const firstParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** `/stats-history?breakdown=exercise` and `?period=7` keep their meaning. */
export const breakdownParam = (value: string | string[] | undefined): ProgressBreakdown | null => {
  const param = firstParam(value);
  return param === undefined ? null : param === 'exercise' ? 'exercise' : 'muscle';
};
export const periodParam = (value: string | string[] | undefined): ProgressPeriod | null => {
  const param = firstParam(value);
  return param === undefined ? null : param === '7' ? 'this-week' : 'window';
};

/** This visit's choices, less every one whose Settings default has since changed. */
const keepUnchangedDefaults = (chosen: Choices, before: Defaults, after: Defaults): Choices =>
  Object.fromEntries(Object.entries(chosen).filter(([field]) =>
    before[field as keyof Defaults] === after[field as keyof Defaults])) as Choices;

// Progress's view choices (family grouping is the screen's, per breakdown):
// what this visit has chosen wins, then the deep link
// it was entered by, then what Settings says Progress opens on. A choice lasts
// for the visit and never changes Settings, so it also answers its tap where no
// preference profile is writable (signed out of a configured build).
// A tab stays mounted, so a deep link can reach it with new params: a param
// whose value changed is a new entry for its field, dropping this visit's
// choice there. A link repeating the params the route already holds is not.
// A Settings default that changes drops this visit's choice for its field too,
// so Progress shows the default just set.
export function useProgressFilters(params: ProgressFilterParams): ProgressFilters {
  const { values } = useAccountLocalPreferenceState();
  const defaults: Defaults = {
    breakdown: values.progressBreakdown, period: values.progressPeriod, metric: values.progressMetric,
    exerciseMetric: values.progressExerciseMetric, countSecondary: values.progressCountSecondary,
  };
  const link = { breakdown: firstParam(params.breakdown), period: firstParam(params.period) };
  const [entered, setEntered] = useState(link);
  const [seenDefaults, setSeenDefaults] = useState(defaults);
  const [chosen, setChosen] = useState<Choices>({});
  const choose = (patch: Choices) => setChosen(current => ({ ...current, ...patch }));
  if (link.breakdown !== entered.breakdown || link.period !== entered.period) {
    setEntered(link);
    setChosen(({ breakdown, period, ...current }) => ({
      ...current,
      ...(link.breakdown === entered.breakdown ? { breakdown } : {}),
      ...(link.period === entered.period ? { period } : {}),
    }));
  }
  if ((Object.keys(defaults) as (keyof Defaults)[]).some(field => defaults[field] !== seenDefaults[field])) {
    setSeenDefaults(defaults);
    setChosen(current => keepUnchangedDefaults(current, seenDefaults, defaults));
  }
  const entry = { breakdown: breakdownParam(entered.breakdown), period: periodParam(entered.period) };

  return {
    breakdown: chosen.breakdown ?? entry.breakdown ?? defaults.breakdown,
    period: chosen.period ?? entry.period ?? defaults.period,
    metric: chosen.metric ?? defaults.metric,
    exerciseMetric: chosen.exerciseMetric ?? defaults.exerciseMetric,
    countSecondary: chosen.countSecondary ?? defaults.countSecondary,
    selectBreakdown: breakdown => choose({ breakdown }),
    selectPeriod: period => choose({ period }),
    selectMetric: metric => choose({ metric }),
    selectExerciseMetric: exerciseMetric => choose({ exerciseMetric }),
    selectCountSecondary: countSecondary => choose({ countSecondary }),
  };
}
