/**
 * At a glance's periods (`src/groups/home-periods.ts`): which local windows one
 * read asks for, and how a period-totals read becomes the page's members —
 * only when it answers exactly those windows.
 */
import {
  GROUP_RANK_PERIODS,
  groupHomeSeriesWindows,
  readGroupHomeSeries,
  toCompetitionPeriodWindows,
} from '@/src/groups/home-periods';
import type { CompetitionPeriodTotalsWire } from '@/src/groups/competition-wire';
import { UNNAMED_MEMBER_LABEL } from '@/src/groups/stream-view-model';

// Wed 14 Oct 2026, 18:30 local.
const NOW = new Date(2026, 9, 14, 18, 30);

const totalsFor = (windows: { start_ms: number; end_ms: number }[]): CompetitionPeriodTotalsWire => ({
  contract_version: 4,
  group_id: 'g1',
  periods: windows.map((window) => ({
    ...window,
    members: [
      { member: { user_id: 'me', username: 'dino' }, working_sets: 9, group_records: 2 },
      { member: { user_id: 'u2', username: '  ' }, working_sets: 0, group_records: 0 },
      { member: { user_id: 'u3', username: 'sara' }, working_sets: 14, group_records: 1 },
    ],
  })),
});

describe('groupHomeSeriesWindows', () => {
  it('asks for the week in view and the five before it, oldest first, back to back', () => {
    const windows = groupHomeSeriesWindows({ period: 'week', offset: 0, now: NOW });

    expect(windows).toHaveLength(GROUP_RANK_PERIODS);
    expect(windows[5]).toEqual({ start: new Date(2026, 9, 12), end: new Date(2026, 9, 19) });
    expect(windows[0]).toEqual({ start: new Date(2026, 8, 7), end: new Date(2026, 8, 14) });
    windows.slice(1).forEach((window, index) => expect(window.start).toEqual(windows[index]!.end));
  });

  it('moves the whole span with the stepper', () => {
    const current = groupHomeSeriesWindows({ period: 'week', offset: 0, now: NOW });
    const earlier = groupHomeSeriesWindows({ period: 'week', offset: -1, now: NOW });

    expect(earlier.slice(1)).toEqual(current.slice(0, 5));
  });

  it('keeps Monday weeks across the year and DST boundaries', () => {
    for (const now of [new Date(2027, 0, 1), new Date(2026, 2, 29), new Date(2026, 9, 25)]) {
      const windows = groupHomeSeriesWindows({ period: 'week', offset: 0, now });
      expect(windows.every(w => w.start.getDay() === 1 && w.end.getDay() === 1)).toBe(true);
      expect(windows.every(w => w.start.getHours() === 0 && w.end.getHours() === 0)).toBe(true);
      expect(windows.slice(1).every((w, i) => w.start.getTime() === windows[i].end.getTime())).toBe(true);
    }
  });
});

describe('readGroupHomeSeries', () => {
  const windows = groupHomeSeriesWindows({ period: 'week', offset: 0, now: NOW });

  it('maps every window to its members: me as You, a blank username as the unnamed label', () => {
    const series = readGroupHomeSeries({ totals: totalsFor(toCompetitionPeriodWindows(windows)), windows, myUserId: 'me' });

    expect(series).toHaveLength(GROUP_RANK_PERIODS);
    expect(series![5]!.window).toBe(windows[5]);
    expect(series![5]!.members).toEqual([
      { userId: 'me', name: 'You', isMe: true, sets: 9, prs: 2 },
      { userId: 'u2', name: UNNAMED_MEMBER_LABEL, isMe: false, sets: 0, prs: 0 },
      { userId: 'u3', name: 'sara', isMe: false, sets: 14, prs: 1 },
    ]);
  });

  it('returns nothing for a read of other windows, so a stale week never shows', () => {
    const lastWeek = groupHomeSeriesWindows({ period: 'week', offset: -1, now: NOW });
    expect(readGroupHomeSeries({ totals: totalsFor(toCompetitionPeriodWindows(lastWeek)), windows, myUserId: 'me' })).toBeNull();
    expect(readGroupHomeSeries({ totals: totalsFor(toCompetitionPeriodWindows(windows.slice(1))), windows, myUserId: 'me' })).toBeNull();
  });
});
