import { useState } from 'react';

import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import type { ProgressBreakdown, ProgressMetric } from '@/src/preferences/model';

// Settings' Progress period, or its one-week alternative. Not a preference:
// every visit opens on the configured window ([[comparison.window]]) unless
// its deep link asks for the week.
export type ProgressPeriod = 'window' | 'this-week';

export type ProgressFilterParams = {
  breakdown?: string | string[];
  period?: string | string[];
};

export type ProgressFilters = {
  breakdown: ProgressBreakdown;
  period: ProgressPeriod;
  metric: ProgressMetric;
  selectBreakdown: (next: ProgressBreakdown) => void;
  selectPeriod: (next: ProgressPeriod) => void;
  selectMetric: (next: ProgressMetric) => void;
};

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

// Progress's filter row: what this visit has chosen wins, then the deep link it
// was entered by, then — for the breakdown and the metric — what the last visit
// stored. The period has no stored value and falls back to Settings' window.
// A choice is held here as well as written to the store, so a chip still
// answers its tap where no preference profile is writable (signed out of a
// configured build).
// A tab stays mounted, so a deep link can reach it with new params: a param
// whose value changed is a new entry for its field, dropping this visit's
// choice there. A link repeating the params the route already holds is not.
export function useProgressFilters(params: ProgressFilterParams): ProgressFilters {
  const { values } = useAccountLocalPreferenceState();
  const link = { breakdown: firstParam(params.breakdown), period: firstParam(params.period) };
  const [entered, setEntered] = useState(link);
  const [chosen, setChosen] = useState<{
    breakdown?: ProgressBreakdown; period?: ProgressPeriod; metric?: ProgressMetric;
  }>({});
  const choose = (patch: typeof chosen) => setChosen(current => ({ ...current, ...patch }));
  if (link.breakdown !== entered.breakdown || link.period !== entered.period) {
    setEntered(link);
    setChosen(({ breakdown, period, ...current }) => ({
      ...current,
      ...(link.breakdown === entered.breakdown ? { breakdown } : {}),
      ...(link.period === entered.period ? { period } : {}),
    }));
  }
  const entry = { breakdown: breakdownParam(entered.breakdown), period: periodParam(entered.period) };

  return {
    breakdown: chosen.breakdown ?? entry.breakdown ?? values.progressBreakdown,
    period: chosen.period ?? entry.period ?? 'window',
    metric: chosen.metric ?? values.progressMetric,
    selectBreakdown: breakdown => {
      choose({ breakdown });
      updatePreferences({ progressBreakdown: breakdown });
    },
    selectPeriod: period => choose({ period }),
    selectMetric: metric => {
      choose({ metric });
      updatePreferences({ progressMetric: metric });
    },
  };
}
