/**
 * Today's group card's read of the group stream for its recent sessions: read
 * once per group and latest session, again for more room, and after a failure
 * only when the group's week is read again. The card-level flow is
 * today-group-card.test.tsx.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useGroupRecentSessions } from '@/components/today/use-group-recent-sessions';
import type { CompetitionStreamWire } from '@/src/groups/competition-wire';

import { competitionSession } from './helpers/competition-fixtures';

const item = (sessionId: string) => ({
  kind: 'session' as const, key: sessionId, sort_at_ms: 1, groups: [{ group_id: 'g1', name: 'Crew' }],
  session: { ...competitionSession.session, session_id: sessionId },
});
const page = (...ids: string[]): CompetitionStreamWire => ({ contract_version: 4, items: ids.map(item), next_cursor: null, has_more: false });

type Props = { latest: string; wanted: number; week: object };

const render = (loadPage: jest.Mock, initialProps: Props) =>
  renderHook(({ latest, wanted, week }: Props) => useGroupRecentSessions('g1', latest, wanted, loadPage, week), { initialProps });

it('reads once, keeps a good read across week refreshes, and reads again only for a newer latest session', async () => {
  const loadPage = jest.fn().mockResolvedValue(page('a', 'b'));
  const week = {};
  const { result, rerender } = render(loadPage, { latest: 'a', wanted: 2, week });

  await waitFor(() => expect(result.current.sessions.map((session) => session.session_id)).toEqual(['a', 'b']));
  rerender({ latest: 'a', wanted: 2, week: {} });
  rerender({ latest: 'a', wanted: 1, week: {} });
  expect(loadPage).toHaveBeenCalledTimes(1);

  rerender({ latest: 'new', wanted: 2, week: {} });
  await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
});

it('reads nothing when the card has no room', () => {
  const loadPage = jest.fn();
  render(loadPage, { latest: 'a', wanted: 0, week: {} });
  expect(loadPage).not.toHaveBeenCalled();
});

it('after a failure, tries again once per new week read, never on its own', async () => {
  const loadPage = jest.fn().mockRejectedValue(new Error('offline'));
  const { result, rerender } = render(loadPage, { latest: 'a', wanted: 2, week: {} });

  await waitFor(() => expect(result.current.failed).toBe(true));
  // The failure itself starts no new read.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadPage).toHaveBeenCalledTimes(1);

  // The group's week read again (Retry, refresh, refocus): one more try, which works.
  loadPage.mockResolvedValue(page('a', 'b'));
  rerender({ latest: 'a', wanted: 2, week: {} });
  await waitFor(() => expect(result.current).toMatchObject({ failed: false, sessions: [expect.anything(), expect.anything()] }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(loadPage).toHaveBeenCalledTimes(2);
});
