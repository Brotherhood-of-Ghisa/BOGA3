/* eslint-disable import/first */

/**
 * Outcome: the recorder's meet banner and the session page's meet row let a
 * member join a session to a meet where they train, from cached meet lists
 * only ([[meets.linking]]): one row per overlapping meet, `Join` or
 * `✓ In <meet> · Leave · ›`, working offline, the page row lasting until the
 * cutoff; and `Challenge` tags mark challenge exercises of joined meets.
 *
 * Driver: the real components over a real in-memory SQLite; the router is mocked.
 */

import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionGroup } from './helpers/competition-fixtures';
import { meetDetailFixture, meetFixture } from './helpers/meet-fixtures';
import { renderWithTheme } from './helpers/theme';

let mockFixture: InMemoryDatabaseFixture;
const mockRouter = { push: jest.fn() };
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/groups/use-group-exercise-linking', () => ({ useGroupLinkingUserId: () => 'u1' }));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(callback, [callback]),
}));

import { SessionMeetBanner } from '@/components/session-recorder/session-meet-banner';
import { SessionExerciseCard } from '@/components/session-view/session-exercise-card';
import { SessionMeetRows } from '@/components/view-session/session-meet-rows';
import { ViewSessionScreen } from '@/components/view-session';
import { exerciseDefinitions, exerciseGroupLinks, sessionMeetLinks, sessions } from '@/src/data/schema';
import { forgetGroupCacheMemory, groupCacheKeys, writeGroupCache } from '@/src/groups/cache';
import type { MeetWire } from '@/src/groups/meet-wire';
import * as sessionMeets from '@/src/groups/session-meets';

const HOUR = 3_600_000;
const NOW = Date.now();
const liveMeet = (patch: Partial<MeetWire> = {}) =>
  meetFixture({ meet_id: 'live', starts_at_ms: NOW - HOUR, ends_at_ms: NOW + 2 * HOUR, cutoff_at_ms: NOW + 26 * HOUR, title: 'Saturday lifts', state: 'live', ...patch });
const endedMeet = (patch: Partial<MeetWire> = {}) =>
  meetFixture({ meet_id: 'ended', starts_at_ms: NOW - 6 * HOUR, ends_at_ms: NOW - 3 * HOUR, cutoff_at_ms: NOW + 21 * HOUR, title: 'Morning lifts', state: 'finalizing', ...patch });

const seed = (key: string, payload: unknown) =>
  writeGroupCache(mockFixture.database, { cacheKey: key, userId: 'u1', payload, fetchedAtMs: NOW });
const seedMeets = (byGroup: Record<string, { name: string; meets: MeetWire[] }>) => {
  seed(groupCacheKeys.mine, { groups: Object.entries(byGroup).map(([id, g]) => ({ ...competitionGroup, group_id: id, name: g.name })) });
  for (const [id, g] of Object.entries(byGroup)) seed(groupCacheKeys.meets(id), { upcoming: g.meets, past: [], next_cursor: null });
};
const insertSession = (id: string, startedAtMs: number, completedAtMs: number | null) =>
  mockFixture.database.insert(sessions).values({
    id, status: completedAtMs === null ? 'active' : 'completed',
    startedAt: new Date(startedAtMs), completedAt: completedAtMs === null ? null : new Date(completedAtMs),
  }).run();
const liveLinks = () => mockFixture.database.select().from(sessionMeetLinks).all().filter((l) => l.deletedAt === null);
const running = { status: 'active', startedAt: new Date(NOW - 30 * 60_000), completedAt: null } as const;

beforeEach(() => {
  mockFixture = createInMemoryDatabase({ foreignKeys: true });
  forgetGroupCacheMemory();
  jest.clearAllMocks();
  insertSession('s1', NOW - 30 * 60_000, null);
});
afterEach(() => mockFixture.close());

describe('recorder meet banner', () => {
  it('draws nothing without a cached meet overlapping the session', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [endedMeet(), liveMeet({ meet_id: 'later', starts_at_ms: NOW + HOUR, ends_at_ms: NOW + 4 * HOUR, cutoff_at_ms: NOW + 28 * HOUR })] } });
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    await act(async () => undefined);
    expect(screen.queryByTestId('session-meet-banner')).toBeNull();
  });

  it('draws one row per overlapping meet, across groups', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [liveMeet()] }, g2: { name: 'Club', meets: [liveMeet({ meet_id: 'live2', group_id: 'g2', title: null })] } });
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    expect(await screen.findByText('Saturday lifts · Crew')).toBeTruthy();
    expect(screen.getByText('Meet · Club')).toBeTruthy();
    expect(screen.getAllByText('Join')).toHaveLength(2);
  });

  it('Join creates the synced link and shows ✓ In · Leave · ›; Leave tombstones only this session\'s link', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [liveMeet()] } });
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    fireEvent.press(await screen.findByTestId('session-meet-banner-live-join'));
    expect(await screen.findByText('In Saturday lifts')).toBeTruthy();
    expect(liveLinks()).toMatchObject([{ id: 'live:s1', sessionId: 's1', localDirty: true }]);

    fireEvent.press(screen.getByTestId('session-meet-banner-live-open'));
    expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/meets/live');

    fireEvent.press(screen.getByTestId('session-meet-banner-live-leave'));
    expect(await screen.findByText('Saturday lifts · Crew')).toBeTruthy();
    expect(liveLinks()).toEqual([]);
    expect(mockFixture.database.select().from(sessionMeetLinks).all()).toHaveLength(1);

    fireEvent.press(screen.getByTestId('session-meet-banner-live-join'));
    await screen.findByText('In Saturday lifts');
    expect(mockFixture.database.select().from(sessionMeetLinks).all()).toHaveLength(1);
  });

  it('starts one write at a time: a second tap before the first settles does nothing', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [liveMeet()] } });
    const join = jest.spyOn(sessionMeets, 'joinMeetFromSession');
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    const button = await screen.findByTestId('session-meet-banner-live-join');
    fireEvent.press(button);
    fireEvent.press(button);
    await screen.findByText('In Saturday lifts');
    expect(join).toHaveBeenCalledTimes(1);
    join.mockRestore();
  });

  it('applies only the newest read when reads finish out of order', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [liveMeet()] } });
    const real = sessionMeets.joinedMeetIds;
    const pending: ((ids: Set<string>) => void)[] = [];
    const reads = jest.spyOn(sessionMeets, 'joinedMeetIds').mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    await waitFor(() => expect(pending).toHaveLength(1)); // the mount read, left hanging
    reads.mockImplementation(real);
    // A newer read (the change signal) lands first with the session joined...
    mockFixture.database.insert(sessionMeetLinks).values({ id: 'live:s1', sessionId: 's1', meetId: 'live', createdAt: new Date(), updatedAt: new Date() }).run();
    await act(async () => { await sessionMeets.joinMeetFromSession('s1', liveMeet()); });
    expect(await screen.findByText('In Saturday lifts')).toBeTruthy();
    // ...then the older read finishes with nothing joined and must not win.
    await act(async () => pending[0](new Set()));
    expect(screen.getByText('In Saturday lifts')).toBeTruthy();
    reads.mockRestore();
  });

  it('shows a joined row from the local link alone', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [liveMeet()] } });
    mockFixture.database.insert(sessionMeetLinks).values({ id: 'live:s1', sessionId: 's1', meetId: 'live', createdAt: new Date(), updatedAt: new Date() }).run();
    renderWithTheme(<SessionMeetBanner sessionId="s1" times={running} />);
    expect(await screen.findByText('In Saturday lifts')).toBeTruthy();
    expect(screen.getByTestId('session-meet-banner-live-open')).toBeTruthy();
  });
});

describe('session page meet row', () => {
  const finished = { status: 'completed', startedAt: new Date(NOW - 5 * HOUR), completedAt: new Date(NOW - 4 * HOUR) } as const;
  beforeEach(() => insertSession('done', NOW - 5 * HOUR, NOW - 4 * HOUR));

  it('offers Join to a finished session until the cutoff, and nothing after or without overlap', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [
      endedMeet(),
      endedMeet({ meet_id: 'closed', ends_at_ms: NOW - 25 * HOUR, starts_at_ms: NOW - 28 * HOUR, cutoff_at_ms: NOW - HOUR }),
      endedMeet({ meet_id: 'elsewhen', starts_at_ms: NOW - 12 * HOUR, ends_at_ms: NOW - 9 * HOUR, cutoff_at_ms: NOW + 15 * HOUR }),
    ] } });
    renderWithTheme(<SessionMeetRows sessionId="done" times={finished} />);
    expect(await screen.findByText('Morning lifts · Crew')).toBeTruthy();
    expect(screen.getAllByText('Join')).toHaveLength(1);

    fireEvent.press(screen.getByTestId('session-meet-row-ended-join'));
    expect(await screen.findByText('In Morning lifts')).toBeTruthy();
    expect(liveLinks()).toMatchObject([{ id: 'ended:done' }]);
    fireEvent.press(screen.getByTestId('session-meet-row-ended-leave'));
    await screen.findByText('Morning lifts · Crew');
    expect(liveLinks()).toEqual([]);
  });

  it('draws nothing when no cached meet overlaps', async () => {
    seedMeets({ g1: { name: 'Crew', meets: [] } });
    renderWithTheme(<SessionMeetRows sessionId="done" times={finished} />);
    await act(async () => undefined);
    expect(screen.queryByTestId('session-meet-rows')).toBeNull();
  });
});

describe('Challenge tag', () => {
  const card = { id: 'se1', name: 'Squat', doneCount: 1, totalCount: 2, rows: [], record: [] };
  it('marks a recorder card only when asked to', () => {
    const { rerender } = renderWithTheme(<SessionExerciseCard card={card} />);
    expect(screen.queryByText('Challenge')).toBeNull();
    rerender(<SessionExerciseCard card={card} challenge />);
    expect(screen.getByText('Challenge')).toBeTruthy();
    expect(screen.getByTestId('session-view-exercise-se1').props.accessibilityLabel).toContain('Challenge');
  });

  it('tags a View Session card whose exercise has a live group link to a challenge of a joined meet', async () => {
    const db = mockFixture.database;
    ['squat', 'curl'].forEach((id) => db.insert(exerciseDefinitions).values({ id, name: id }).run());
    db.insert(exerciseGroupLinks).values({ id: 'g1:squat', exerciseDefinitionId: 'squat', groupId: 'g1', groupExerciseId: 'ge1' }).run();
    db.insert(exerciseGroupLinks).values({ id: 'g1:curl', exerciseDefinitionId: 'curl', groupId: 'g1', groupExerciseId: 'other' }).run();
    insertSession('done', NOW - 5 * HOUR, NOW - 4 * HOUR);
    seedMeets({ g1: { name: 'Crew', meets: [endedMeet({ meet_id: 'm1' })] } });
    const detail = meetDetailFixture();
    seed(groupCacheKeys.meet('g1', 'm1'), { ...detail, meet: endedMeet({ meet_id: 'm1' }), challenges: [{ ...detail.challenges[0], meet_id: 'm1' }] });
    db.insert(sessionMeetLinks).values({ id: 'm1:done', sessionId: 'done', meetId: 'm1', createdAt: new Date(), updatedAt: new Date() }).run();

    const cards = ['squat', 'curl'].map((definition) => ({ id: `card-${definition}`, exerciseDefinitionId: definition, name: definition, setCount: 1, rows: [], record: [] }));
    renderWithTheme(
      <ViewSessionScreen
        busy={false}
        error={null}
        meetSession={{ sessionId: 'done', startedAt: new Date(NOW - 5 * HOUR), completedAt: new Date(NOW - 4 * HOUR) }}
        model={{ cards, workingSetCount: 2, volume: '0' }}
        onBack={jest.fn()}
        onEdit={jest.fn()}
        onSectionChange={jest.fn()}
        onToggleDeleted={jest.fn()}
        section="sets"
        summary={{ title: 'Training', start: 'now', duration: '1h', gymName: null, deleted: false }}
        summaryContent={null}
      />
    );
    await waitFor(() => expect(screen.getByTestId('completed-session-detail-exercise-card-squat-challenge')).toBeTruthy());
    expect(screen.queryByTestId('completed-session-detail-exercise-card-curl-challenge')).toBeNull();
    expect(screen.getByText('In Morning lifts')).toBeTruthy();
  });
});
