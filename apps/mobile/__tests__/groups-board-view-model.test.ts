/**
 * Board view model (E1.1–E1.3, P7): the ordinal and date formats, member
 * labels, and route params the competition boards share.
 */

import {
  formatBoardDate,
  formatBoardMemberLabel,
  formatOrdinal,
  groupBoardPath,
  parseBoardScopeParam,
} from '@/src/groups';

const ME = 'user-me';
/** 12 Sep 2026, local noon. */
const NOW = new Date(2026, 8, 12, 12, 0).getTime();
const SEP_12 = new Date(2026, 8, 12, 9, 0).getTime();

describe('formatting', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
  ])('formatOrdinal(%d) is %s', (value, expected) => {
    expect(formatOrdinal(value)).toBe(expected);
  });

  it('dates read "12 Sep", with the year only outside the current year', () => {
    expect(formatBoardDate(SEP_12, NOW)).toBe('12 Sep');
    expect(formatBoardDate(new Date(2025, 6, 2, 9).getTime(), NOW)).toBe('2 Jul 2025');
  });

  it('an invalid scope param falls back to Certified; the board path carries its view', () => {
    expect(parseBoardScopeParam('all')).toBe('all');
    expect(parseBoardScopeParam(['all'])).toBe('all');
    expect(parseBoardScopeParam('everything')).toBe('certified');
    expect(parseBoardScopeParam(undefined)).toBe('certified');
    expect(groupBoardPath('g1', 'ge1')).toBe('/group/g1/leaderboards/ge1');
    expect(groupBoardPath('g1', 'ge1', { metric: 'weight', scope: 'all' })).toBe(
      '/group/g1/leaderboards/ge1?metric=weight&scope=all',
    );
  });

  it('member labels read You for me, the username else, and mark former members (P7)', () => {
    expect(formatBoardMemberLabel({ user_id: ME, username: 'dino' }, false, ME)).toBe('You');
    expect(formatBoardMemberLabel({ user_id: 'u2', username: 'sam' }, true, ME)).toBe('sam (former)');
    expect(formatBoardMemberLabel({ user_id: 'u3', username: null }, false, null)).toBe('Unnamed member');
  });
});
