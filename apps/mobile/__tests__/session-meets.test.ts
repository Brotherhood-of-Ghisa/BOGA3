/* eslint-disable import/first */

/**
 * Outcome: a member joins sessions to meets where they train, online or offline
 * ([[meets.linking]]). The recorder offers a meet only inside its window, the
 * session page until its cutoff, and never a meet the session cannot overlap;
 * Join and Leave write only this session's synced link; the meet page's Leave
 * tombstones every link this device holds; and an exercise is a challenge
 * exercise only through a live group link to a joined meet's challenge.
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle, with
 * the cached meet lists and details in `group_cache` and the sync pull mocked.
 */

import { eq } from 'drizzle-orm';

import { createInMemoryDatabase, type InMemoryDatabaseFixture, type InMemoryTestDatabase } from './helpers/in-memory-db';
import { meetDetailFixture, meetFixture } from './helpers/meet-fixtures';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
const mockRunSyncCycle = jest.fn();
jest.mock('@/src/sync/cycle', () => ({ runSyncCycle: () => mockRunSyncCycle() }));

import { __resetClockForTests } from '@/src/data/clock';
import { exerciseDefinitions, exerciseGroupLinks, sessionMeetLinks, sessions } from '@/src/data/schema';
import { forgetGroupCacheMemory, groupCacheKeys, writeGroupCache } from '@/src/groups/cache';
import type { MeetWire } from '@/src/groups/meet-wire';
import {
  joinedMeetIds,
  joinMeetFromSession,
  leaveMeetFromSession,
  leaveMeetLinks,
  exerciseIdsOfDefinitions,
  loadChallengeExerciseIds,
  offeredMeets,
  readCachedMeetCandidates,
  subscribeSessionMeetLinks,
  type SessionMeetCandidate,
  type SessionMeetTimes,
} from '@/src/groups/session-meets';
import { competitionGroup } from './helpers/competition-fixtures';

let fixture: InMemoryDatabaseFixture;
const db = (): InMemoryTestDatabase => fixture.database;

const HOUR = 3_600_000;
const STARTS = 1_800_000_000_000;
const meet = (patch: Partial<MeetWire> = {}): MeetWire => meetFixture({ starts_at_ms: STARTS, ends_at_ms: STARTS + 3 * HOUR, cutoff_at_ms: STARTS + 27 * HOUR, ...patch });
const candidate = (patch: Partial<MeetWire> = {}): SessionMeetCandidate => ({ meet: meet(patch), groupName: 'Crew' });
const running = (startedAtMs: number): SessionMeetTimes => ({ status: 'active', startedAt: new Date(startedAtMs), completedAt: null });
const finished = (startedAtMs: number, endedAtMs: number): SessionMeetTimes =>
  ({ status: 'completed', startedAt: new Date(startedAtMs), completedAt: new Date(endedAtMs) });

const seedCache = (key: string, payload: unknown) =>
  writeGroupCache(db(), { cacheKey: key, userId: 'u1', payload, fetchedAtMs: Date.now() });
const seedMeets = (groups: { id: string; name: string; upcoming?: MeetWire[]; past?: MeetWire[] }[]) => {
  seedCache(groupCacheKeys.mine, { groups: groups.map((g) => ({ ...competitionGroup, group_id: g.id, name: g.name })) });
  for (const g of groups) {
    seedCache(groupCacheKeys.meets(g.id), { upcoming: g.upcoming ?? [], past: g.past ?? [], next_cursor: null });
  }
};
const insertSession = (id: string, startedAtMs: number, completedAtMs: number | null) =>
  db().insert(sessions).values({
    id, status: completedAtMs === null ? 'active' : 'completed',
    startedAt: new Date(startedAtMs), completedAt: completedAtMs === null ? null : new Date(completedAtMs),
  }).run();
const links = () => db().select().from(sessionMeetLinks).all();

beforeEach(() => {
  __resetClockForTests();
  forgetGroupCacheMemory();
  mockRunSyncCycle.mockReset().mockResolvedValue('converged');
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
});
afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
});

describe('readCachedMeetCandidates', () => {
  it('lists the live meets of every cached group, soonest first, without cancelled or duplicate meets', () => {
    seedMeets([
      { id: 'g1', name: 'Crew', upcoming: [meet({ meet_id: 'late', starts_at_ms: STARTS + 5 * HOUR, ends_at_ms: STARTS + 8 * HOUR, cutoff_at_ms: STARTS + 32 * HOUR }), meet({ meet_id: 'x', cancelled_at_ms: 1, state: 'cancelled' })] },
      { id: 'g2', name: 'Other', past: [meet({ meet_id: 'early', group_id: 'g2' }), meet({ meet_id: 'late', group_id: 'g2' })] },
    ]);
    expect(readCachedMeetCandidates(db(), 'u1').map((c) => [c.meet.meet_id, c.groupName])).toEqual([['early', 'Other'], ['late', 'Crew']]);
  });

  it('reads nothing for a group whose meet list was never cached, or another account', () => {
    seedCache(groupCacheKeys.mine, { groups: [{ ...competitionGroup, group_id: 'g1' }] });
    expect(readCachedMeetCandidates(db(), 'u1')).toEqual([]);
    seedMeets([{ id: 'g1', name: 'Crew', upcoming: [meet()] }]);
    expect(readCachedMeetCandidates(db(), 'someone-else')).toEqual([]);
  });
});

describe('offeredMeets', () => {
  const both = [candidate()];
  it('offers the recorder a meet only while now is inside its window', () => {
    const session = running(STARTS - HOUR);
    expect(offeredMeets(both, session, 'recorder', STARTS - 1)).toEqual([]);
    expect(offeredMeets(both, session, 'recorder', STARTS)).toHaveLength(1);
    expect(offeredMeets(both, session, 'recorder', STARTS + 3 * HOUR - 1)).toHaveLength(1);
    expect(offeredMeets(both, session, 'recorder', STARTS + 3 * HOUR)).toEqual([]);
  });

  it('offers one row per overlapping meet, across groups', () => {
    const several = [candidate({ meet_id: 'a' }), candidate({ meet_id: 'b', group_id: 'g2' })];
    expect(offeredMeets(several, running(STARTS), 'recorder', STARTS + HOUR).map((c) => c.meet.meet_id)).toEqual(['a', 'b']);
  });

  it('offers a finished session the meet until its cutoff, and not after', () => {
    const session = finished(STARTS + HOUR, STARTS + 2 * HOUR);
    expect(offeredMeets(both, session, 'page', STARTS + 26 * HOUR)).toHaveLength(1);
    expect(offeredMeets(both, session, 'page', STARTS + 27 * HOUR)).toEqual([]);
  });

  it('never offers a session that cannot overlap the window', () => {
    expect(offeredMeets(both, finished(STARTS - 3 * HOUR, STARTS - HOUR), 'page', STARTS + HOUR)).toEqual([]);
    expect(offeredMeets(both, finished(STARTS + 3 * HOUR, STARTS + 4 * HOUR), 'page', STARTS + 5 * HOUR)).toEqual([]);
  });
});

describe('Join and Leave from a session', () => {
  beforeEach(() => insertSession('s1', STARTS + HOUR, STARTS + 2 * HOUR));
  const at = new Date(STARTS + 4 * HOUR);

  it('creates a dirty link offline, tombstones it on Leave and undeletes the same row on a re-join', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSessionMeetLinks(listener);
    expect(await joinMeetFromSession('s1', meet(), at)).toEqual({ ok: true });
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ id: 'm1:s1', sessionId: 's1', meetId: 'm1', deletedAt: null, localDirty: true });
    expect([...(await joinedMeetIds('s1'))]).toEqual(['m1']);

    db().update(sessionMeetLinks).set({ localDirty: false }).run();
    expect(await leaveMeetFromSession('s1', meet(), at)).toEqual({ ok: true });
    expect(links()[0].deletedAt).not.toBeNull();
    expect(links()[0].localDirty).toBe(true);
    expect((await joinedMeetIds('s1')).size).toBe(0);

    expect(await joinMeetFromSession('s1', meet(), at)).toEqual({ ok: true });
    expect(links()).toHaveLength(1);
    expect(links()[0].deletedAt).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(mockRunSyncCycle).not.toHaveBeenCalled();
  });

  it('Leave tombstones only this session\'s link', async () => {
    insertSession('s2', STARTS + HOUR, STARTS + 2 * HOUR);
    await joinMeetFromSession('s1', meet(), at);
    await joinMeetFromSession('s2', meet(), at);
    await leaveMeetFromSession('s1', meet(), at);
    expect(links().filter((l) => l.deletedAt === null).map((l) => l.sessionId)).toEqual(['s2']);
  });

  it('refuses a meet that has closed and a session that cannot overlap, naming why', async () => {
    expect(await joinMeetFromSession('s1', meet(), new Date(STARTS + 27 * HOUR))).toEqual({ ok: false, failure: 'closed' });
    insertSession('early', STARTS - 3 * HOUR, STARTS - HOUR);
    expect(await joinMeetFromSession('early', meet(), at)).toEqual({ ok: false, failure: 'window' });
    expect(await joinMeetFromSession('missing', meet(), at)).toEqual({ ok: false, failure: 'failed' });
    expect(links()).toEqual([]);
  });
});

describe('leaveMeetLinks (the meet page\'s Leave)', () => {
  const at = new Date(STARTS + 4 * HOUR);
  beforeEach(async () => {
    for (const id of ['s1', 's2']) insertSession(id, STARTS + HOUR, STARTS + 2 * HOUR);
    await joinMeetFromSession('s1', meet(), at);
    await joinMeetFromSession('s2', meet(), at);
    await joinMeetFromSession('s1', meet({ meet_id: 'other' }), at);
  });

  it('pulls first, then tombstones every local link for that meet and no other', async () => {
    const order: string[] = [];
    mockRunSyncCycle.mockImplementationOnce(async () => {
      order.push('pull');
      // A link made on another device arrives with the pull.
      insertSession('s3', STARTS + HOUR, STARTS + 2 * HOUR);
      db().insert(sessionMeetLinks).values({ id: 'm1:s3', sessionId: 's3', meetId: 'm1', createdAt: new Date(), updatedAt: new Date() }).run();
      return 'converged';
    }).mockImplementationOnce(async () => {
      order.push('push');
      return 'converged';
    });
    expect(await leaveMeetLinks(meet(), at)).toEqual({ left: 3, pulled: true });
    expect(order).toEqual(['pull', 'push']); // the pull first, then the push of the tombstones
    expect(links().filter((l) => l.deletedAt === null).map((l) => l.id)).toEqual(['other:s1']);
  });

  it('still tombstones what this device holds when the pull fails, and says it did not pull', async () => {
    mockRunSyncCycle.mockRejectedValue(new Error('offline'));
    expect(await leaveMeetLinks(meet(), at)).toEqual({ left: 2, pulled: false });
    mockRunSyncCycle.mockResolvedValue('auth-required');
    await joinMeetFromSession('s1', meet(), at);
    expect(await leaveMeetLinks(meet(), at)).toEqual({ left: 1, pulled: false });
  });

  it('leaves a link that only reaches this device after the leave untouched', async () => {
    await leaveMeetLinks(meet(), at);
    insertSession('s4', STARTS + HOUR, STARTS + 2 * HOUR);
    db().insert(sessionMeetLinks).values({ id: 'm1:s4', sessionId: 's4', meetId: 'm1', createdAt: new Date(), updatedAt: new Date() }).run();
    expect((await joinedMeetIds('s4')).has('m1')).toBe(true);
  });

  it('skips the push when there was nothing to tombstone', async () => {
    await leaveMeetLinks(meet(), at);
    mockRunSyncCycle.mockClear();
    expect(await leaveMeetLinks(meet(), at)).toEqual({ left: 0, pulled: true });
    expect(mockRunSyncCycle).toHaveBeenCalledTimes(1); // the pull only
  });

  it('refuses once the meet has closed', async () => {
    await expect(leaveMeetLinks(meet(), new Date(STARTS + 27 * HOUR))).rejects.toThrow('has closed');
    expect(links().filter((l) => l.deletedAt === null)).toHaveLength(3);
  });
});

describe('loadChallengeExerciseIds', () => {
  const at = new Date(STARTS + 4 * HOUR);
  const exercise = (id: string) => db().insert(exerciseDefinitions).values({ id, name: id }).run();
  const groupLink = (definitionId: string, groupId = 'g1', groupExerciseId = 'ge1', deletedAt: Date | null = null) =>
    db().insert(exerciseGroupLinks).values({ id: `${groupId}:${definitionId}`, exerciseDefinitionId: definitionId, groupId, groupExerciseId, deletedAt }).run();

  beforeEach(() => {
    insertSession('s1', STARTS + HOUR, STARTS + 2 * HOUR);
    seedMeets([{ id: 'g1', name: 'Crew', upcoming: [meet()] }]);
    seedCache(groupCacheKeys.meet('g1', 'm1'), meetDetailFixture());
  });

  it('tags only exercises with a live group link to a challenge of a joined meet', async () => {
    ['squat', 'bench', 'curl', 'dead', 'unlinked'].forEach(exercise);
    groupLink('squat');
    groupLink('bench', 'g1', 'ge-not-a-challenge');
    groupLink('curl', 'g2');
    groupLink('dead', 'g1', 'ge1', new Date());
    const ids = ['squat', 'bench', 'curl', 'dead', 'unlinked'];

    expect([...(await loadChallengeExerciseIds('u1', 's1', ids))]).toEqual([]);
    await joinMeetFromSession('s1', meet(), at);
    expect([...(await loadChallengeExerciseIds('u1', 's1', ids))]).toEqual(['squat']);
    await leaveMeetFromSession('s1', meet(), at);
    expect([...(await loadChallengeExerciseIds('u1', 's1', ids))]).toEqual([]);
  });

  it('tags nothing for another account, once the group link is gone, or with no exercises', async () => {
    exercise('squat');
    groupLink('squat');
    await joinMeetFromSession('s1', meet(), at);
    expect([...(await loadChallengeExerciseIds('other', 's1', ['squat']))]).toEqual([]);
    db().delete(exerciseGroupLinks).where(eq(exerciseGroupLinks.id, 'g1:squat')).run();
    expect([...(await loadChallengeExerciseIds('u1', 's1', ['squat']))]).toEqual([]);
    expect([...(await loadChallengeExerciseIds('u1', 's1', []))]).toEqual([]);
  });
});

describe('exerciseIdsOfDefinitions', () => {
  it('maps challenge exercise definitions to the session exercises (cards) that use them', () => {
    const exercises = [{ id: 'a', exerciseDefinitionId: 'squat' }, { id: 'b', exerciseDefinitionId: 'curl' }, { id: 'c', exerciseDefinitionId: 'squat' }];
    expect([...exerciseIdsOfDefinitions(exercises, new Set(['squat']))]).toEqual(['a', 'c']);
    expect(exerciseIdsOfDefinitions(exercises, new Set()).size).toBe(0);
  });
});
