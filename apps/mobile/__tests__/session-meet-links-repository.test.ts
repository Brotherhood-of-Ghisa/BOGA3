/* eslint-disable import/first */

/**
 * Outcome: a member's session → meet links are local synced rows with a
 * deterministic id, so leaving tombstones the row and re-joining undeletes the
 * same id (sync-v2 contract, "LWW and undelete"), a session that can no
 * longer overlap the meet window is never attached ([[meets.linking]]), and
 * nothing joins or leaves once the meet has closed at its results cutoff.
 *
 * Driver: a real in-memory SQLite built from the shipped migration bundle (FK
 * enforcement on, like the production handle), with `bootstrapLocalDataLayer`
 * pointed at it so the real repository runs end to end.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

const mockNotifyLocalWrite = jest.fn();
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: () => mockNotifyLocalWrite() }));

// Imported AFTER the mocks so the repository binds to them.
import { __resetClockForTests } from '@/src/data/clock';
import {
  joinSessionToMeet,
  leaveMeetSessions,
  leaveSessionMeet,
  listMeetLinksForSession,
  listSessionLinksForMeet,
  sessionCanOverlapMeet,
  sessionMeetLinkId,
  SessionMeetClosedError,
  SessionMeetWindowError,
  type MeetWindow,
} from '@/src/data/session-meet-links';
import { sessionMeetLinks, sessions } from '@/src/data/schema';

let fixture: InMemoryDatabaseFixture;

const db = (): InMemoryTestDatabase => fixture.database;

const HOUR = 3_600_000;
const MEET_ID = '0f8b2c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_MEET_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const STARTS = Date.parse('2026-11-27T18:00:00.000Z');
const WINDOW: MeetWindow = { meetId: MEET_ID, startsAtMs: STARTS, endsAtMs: STARTS + 3 * HOUR, cutoffAtMs: STARTS + 27 * HOUR };
const OTHER_WINDOW: MeetWindow = { ...WINDOW, meetId: OTHER_MEET_ID };
const T0 = new Date(STARTS + HOUR);
const T1 = new Date(STARTS + 2 * HOUR);
const T2 = new Date(STARTS + 4 * HOUR);

const insertSession = (
  id: string,
  startedAtMs: number,
  completedAtMs: number | null,
  extra: { status?: 'active' | 'completed'; deletedAt?: Date | null } = {},
): void => {
  db()
    .insert(sessions)
    .values({
      id,
      status: extra.status ?? (completedAtMs === null ? 'active' : 'completed'),
      startedAt: new Date(startedAtMs),
      completedAt: completedAtMs === null ? null : new Date(completedAtMs),
      deletedAt: extra.deletedAt ?? null,
    })
    .run();
};

const readLink = (id: string) => db().select().from(sessionMeetLinks).where(eq(sessionMeetLinks.id, id)).get();
const allLinkRows = () => db().select().from(sessionMeetLinks).all();

beforeEach(() => {
  __resetClockForTests();
  mockNotifyLocalWrite.mockClear();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  insertSession('sess-in', STARTS + HOUR, STARTS + 2 * HOUR);
  insertSession('sess-running', STARTS - HOUR, null);
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
});

describe('sessionMeetLinkId', () => {
  it('derives <meet_id>:<session_id>, lowercasing the meet UUID and trimming both', () => {
    expect(sessionMeetLinkId(MEET_ID, 'sess-in')).toBe(`${MEET_ID}:sess-in`);
    expect(sessionMeetLinkId(` ${MEET_ID.toUpperCase()} `, ' sess-in ')).toBe(`${MEET_ID}:sess-in`);
  });

  it('refuses blank ids', () => {
    expect(() => sessionMeetLinkId(' ', 'sess-in')).toThrow('meetId is required');
    expect(() => sessionMeetLinkId(MEET_ID, '')).toThrow('sessionId is required');
  });
});

describe('sessionCanOverlapMeet', () => {
  const at = (ms: number) => new Date(ms);
  const done = (start: number, end: number | null) => ({
    status: 'completed' as const,
    startedAt: at(start),
    completedAt: end === null ? null : at(end),
  });
  const { startsAtMs: S, endsAtMs: E } = WINDOW;

  it.each([
    ['inside the window', done(S + 1, E - 1), true],
    ['starting exactly at the end', done(E, E + HOUR), false],
    ['ending exactly at the start', done(S - HOUR, S), false],
    ['starting 1 ms before the end', done(E - 1, E + HOUR), true],
    ['ending 1 ms after the start', done(S - HOUR, S + 1), true],
    ['completed without completedAt, started inside', done(S + 1, null), true],
    ['completed without completedAt, started before', done(S - 1, null), false],
  ])('a completed session %s → %s', (_label, session, expected) => {
    expect(sessionCanOverlapMeet(session, WINDOW)).toBe(expected);
  });

  it('a running session can overlap while it started before the end', () => {
    expect(sessionCanOverlapMeet({ status: 'active', startedAt: at(S - HOUR), completedAt: null }, WINDOW)).toBe(true);
    expect(sessionCanOverlapMeet({ status: 'active', startedAt: at(E), completedAt: null }, WINDOW)).toBe(false);
  });
});

describe('session meet links repository', () => {
  it('joining creates one dirty row under the deterministic id and nudges sync', async () => {
    const link = await joinSessionToMeet('sess-in', WINDOW, T0);

    expect(link).toEqual({ id: `${MEET_ID}:sess-in`, sessionId: 'sess-in', meetId: MEET_ID, createdAt: T0, updatedAt: T0 });
    expect(readLink(link.id)).toMatchObject({ deletedAt: null, localDirty: true });
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('joining an already-joined session is a no-op: nothing dirtied or nudged', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    db().update(sessionMeetLinks).set({ localDirty: false }).run();
    mockNotifyLocalWrite.mockClear();

    const link = await joinSessionToMeet('sess-in', WINDOW, T1);

    expect(link.updatedAt).toEqual(T0);
    expect(readLink(link.id)?.localDirty).toBe(false);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('leaving tombstones the link; re-joining undeletes the same id', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    db().update(sessionMeetLinks).set({ localDirty: false }).run();

    await expect(leaveSessionMeet('sess-in', WINDOW, T1)).resolves.toBe(true);
    const id = `${MEET_ID}:sess-in`;
    expect(readLink(id)).toMatchObject({ deletedAt: T1, updatedAt: T1, localDirty: true });
    const tombstoneClock = readLink(id)?.localUpdatedAtMs ?? 0;

    const rejoined = await joinSessionToMeet('sess-in', WINDOW, T2);
    expect(rejoined).toMatchObject({ id, createdAt: T0, updatedAt: T2 });
    expect(readLink(id)?.deletedAt).toBeNull();
    expect(readLink(id)?.localUpdatedAtMs).toBeGreaterThan(tombstoneClock);
    expect(allLinkRows()).toHaveLength(1);
  });

  it('leaving a missing or already-left link writes nothing', async () => {
    await expect(leaveSessionMeet('sess-in', WINDOW, T1)).resolves.toBe(false);
    await joinSessionToMeet('sess-in', WINDOW, T0);
    await leaveSessionMeet('sess-in', WINDOW, T1);
    mockNotifyLocalWrite.mockClear();

    await expect(leaveSessionMeet('sess-in', WINDOW, T2)).resolves.toBe(false);
    expect(readLink(`${MEET_ID}:sess-in`)?.deletedAt).toEqual(T1);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('refuses a session that cannot overlap the window, writing nothing', async () => {
    insertSession('sess-after', WINDOW.endsAtMs, WINDOW.endsAtMs + HOUR);
    insertSession('sess-before', WINDOW.startsAtMs - 2 * HOUR, WINDOW.startsAtMs);

    await expect(joinSessionToMeet('sess-after', WINDOW, T0)).rejects.toBeInstanceOf(SessionMeetWindowError);
    await expect(joinSessionToMeet('sess-before', WINDOW, T0)).rejects.toThrow(
      `Session sess-before does not overlap meet ${MEET_ID}`,
    );
    expect(allLinkRows()).toHaveLength(0);
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
  });

  it('joins a running session that started before the meet', async () => {
    await expect(joinSessionToMeet('sess-running', WINDOW, T0)).resolves.toMatchObject({ sessionId: 'sess-running' });
  });

  it('refuses a missing or deleted session', async () => {
    insertSession('sess-deleted', STARTS + HOUR, STARTS + 2 * HOUR, { deletedAt: T0 });

    await expect(joinSessionToMeet('sess-missing', WINDOW, T0)).rejects.toThrow('Session sess-missing was not found');
    await expect(joinSessionToMeet('sess-deleted', WINDOW, T0)).rejects.toThrow('Session sess-deleted was not found');
    expect(allLinkRows()).toHaveLength(0);
  });

  it('one session joins meets in several groups', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    await joinSessionToMeet('sess-in', OTHER_WINDOW, T0);

    expect((await listMeetLinksForSession('sess-in')).map((l) => l.meetId)).toEqual([MEET_ID, OTHER_MEET_ID]);
  });

  it('leaving a meet tombstones every live link the member holds to it, and only those', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    await joinSessionToMeet('sess-running', WINDOW, T0);
    await joinSessionToMeet('sess-in', OTHER_WINDOW, T0);
    mockNotifyLocalWrite.mockClear();

    await expect(leaveMeetSessions({ ...WINDOW, meetId: MEET_ID.toUpperCase() }, T1)).resolves.toBe(2);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
    expect(await listSessionLinksForMeet(MEET_ID)).toEqual([]);
    expect((await listSessionLinksForMeet(OTHER_MEET_ID)).map((l) => l.sessionId)).toEqual(['sess-in']);

    await expect(leaveMeetSessions(WINDOW, T2)).resolves.toBe(0);
    expect(mockNotifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('lists only live links, ordered', async () => {
    await joinSessionToMeet('sess-running', WINDOW, T0);
    await joinSessionToMeet('sess-in', WINDOW, T0);
    await leaveSessionMeet('sess-running', WINDOW, T1);

    expect((await listSessionLinksForMeet(MEET_ID)).map((l) => l.sessionId)).toEqual(['sess-in']);
    expect(await listMeetLinksForSession('sess-running')).toEqual([]);
  });

  it('refuses joins and leaves once the meet has closed at its cutoff, writing nothing', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    mockNotifyLocalWrite.mockClear();
    const closed = new Date(WINDOW.cutoffAtMs);

    await expect(joinSessionToMeet('sess-running', WINDOW, closed)).rejects.toBeInstanceOf(SessionMeetClosedError);
    await expect(leaveSessionMeet('sess-in', WINDOW, closed)).rejects.toThrow(`Meet ${MEET_ID} has closed`);
    await expect(leaveMeetSessions(WINDOW, closed)).rejects.toBeInstanceOf(SessionMeetClosedError);
    expect(allLinkRows()).toHaveLength(1);
    expect(readLink(`${MEET_ID}:sess-in`)?.deletedAt).toBeNull();
    expect(mockNotifyLocalWrite).not.toHaveBeenCalled();
    // One millisecond before the cutoff is still open.
    await expect(leaveSessionMeet('sess-in', WINDOW, new Date(WINDOW.cutoffAtMs - 1))).resolves.toBe(true);
  });

  it('does not list a deleted session\'s links, and lists them again when it is undeleted', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    db().update(sessions).set({ deletedAt: T1 }).where(eq(sessions.id, 'sess-in')).run();

    expect(await listSessionLinksForMeet(MEET_ID)).toEqual([]);
    expect(await listMeetLinksForSession('sess-in')).toEqual([]);
    expect(readLink(`${MEET_ID}:sess-in`)?.deletedAt).toBeNull();

    db().update(sessions).set({ deletedAt: null }).where(eq(sessions.id, 'sess-in')).run();
    expect((await listSessionLinksForMeet(MEET_ID)).map((l) => l.sessionId)).toEqual(['sess-in']);
  });

  it('the local CHECK refuses a row whose id is not <meet_id>:<session_id>', () => {
    expect(() =>
      db().insert(sessionMeetLinks).values({ id: 'wrong', sessionId: 'sess-in', meetId: MEET_ID }).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('hard-deleting a session cascades to its links', async () => {
    await joinSessionToMeet('sess-in', WINDOW, T0);
    db().delete(sessions).where(eq(sessions.id, 'sess-in')).run();
    expect(allLinkRows()).toHaveLength(0);
  });
});
