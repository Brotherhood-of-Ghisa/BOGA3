/**
 * Today's group card arrows over the group stream: a newer latest session
 * starts the steps again, so pages read before it never skip what was shared
 * since. The card-level flow is today-group-card.test.tsx.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useGroupSessionSteps } from '@/components/today/use-group-session-steps';
import type { CompetitionStreamWire } from '@/src/groups/competition-wire';

import { competitionSession } from './helpers/competition-fixtures';

const item = (sessionId: string) => ({
  kind: 'session' as const, key: sessionId, sort_at_ms: 1, groups: [{ group_id: 'g1', name: 'Crew' }],
  session: { ...competitionSession.session, session_id: sessionId },
});
const page = (...ids: string[]): CompetitionStreamWire => ({ contract_version: 4, items: ids.map(item), next_cursor: null, has_more: false });

it('starts again from the latest when a newer session becomes the latest', async () => {
  const loadPage = jest.fn().mockResolvedValueOnce(page('a', 'b')).mockResolvedValueOnce(page('new', 'a', 'b'));
  const { result, rerender } = renderHook(({ latest }: { latest: string }) => useGroupSessionSteps('g1', latest, loadPage), {
    initialProps: { latest: 'a' },
  });

  act(() => result.current.older());
  await waitFor(() => expect(result.current.session?.session_id).toBe('b'));
  expect(result.current.canOlder).toBe(false);

  rerender({ latest: 'new' });
  expect(result.current).toMatchObject({ index: 0, session: null, canOlder: true });
  act(() => result.current.older());
  await waitFor(() => expect(result.current.session?.session_id).toBe('a'));
  expect(loadPage).toHaveBeenCalledTimes(2);
});
