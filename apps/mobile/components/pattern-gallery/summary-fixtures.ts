import { groupHomeSeriesWindows, groupRankSeriesEnd, type GroupHomeWindow } from '@/src/groups/home-periods';

export const SUMMARY_NOW = new Date(2026, 9, 30, 12);
export const SUMMARY_STATES = [
  { value: 'ready', label: 'Ready' }, { value: 'past', label: 'Past' },
  { value: 'zero', label: 'Zero' }, { value: 'no-baseline', label: 'No baseline' },
  { value: 'held', label: 'Held' }, { value: 'loading', label: 'Loading' },
  { value: 'error', label: 'Error' }, { value: 'offline', label: 'Offline' },
  { value: 'offline-empty', label: 'Offline empty' },
] as const;
export type SummaryState = typeof SUMMARY_STATES[number]['value'];

// Fixed public read models: the production page retains selection and rendering.
export function summarySeries(offset: number, state: SummaryState, long: boolean): GroupHomeWindow[] | null {
  if (['loading', 'error', 'offline-empty'].includes(state)) return null;
  const sets = [48, 40, 32, 26, 20, 12];
  return groupHomeSeriesWindows({ period: 'week', offset: groupRankSeriesEnd(offset), now: SUMMARY_NOW }).map((window, index) => ({
    window,
    members: ['Alex', 'Maria', 'Sam', 'Jules', 'Luca', 'You'].map((name, memberIndex) => ({
      userId: memberIndex === 5 ? 'me' : `u${memberIndex}`, isMe: memberIndex === 5,
      name: long ? `${name} · Contessa Serbelloni Mazzanti Vien dal Mare` : name,
      sets: state === 'zero' || (state === 'no-baseline' && index < 5) ? 0
        : long ? (memberIndex === 0 ? 123456 : 0) : sets[memberIndex] - (index === 5 ? 0 : 4),
      prs: state === 'zero' || (state === 'no-baseline' && index < 5) ? 0
        : long ? (memberIndex === 0 ? 123456 : 0) : index === 5 || memberIndex < 4 ? 1 : 0,
    })),
  }));
}
