/* eslint-disable import/first */

/**
 * The workout in progress Train shows, read as one row from the migrated
 * in-memory SQLite database (helpers/local-data.ts).
 */

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

import { findActiveSessionId, listSessionListBuckets, setSessionDeletedState } from '@/src/data/session-list';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const ACTIVE = SESSION_VIEW_FIXTURE.sessionId;

beforeEach(() => {
  resetLocalData();
});

afterEach(() => {
  closeLocalData();
});

describe('findActiveSessionId', () => {
  it('reads no workout in progress on an empty database', async () => {
    await bootLocalApp();
    expect(await findActiveSessionId()).toBeNull();
  });

  it('reads the same workout the session list calls active', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();

    expect(await findActiveSessionId()).toBe(ACTIVE);
    expect(await findActiveSessionId()).toBe((await listSessionListBuckets()).active?.id);
  });

  it('agrees with the session list on the most recently updated of two drafts', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();
    await persistSessionDraftSnapshot({
      sessionId: 'later-draft',
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });

    expect(await findActiveSessionId()).toBe((await listSessionListBuckets()).active?.id);
  });

  it('ignores a discarded workout', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();
    await setSessionDeletedState(ACTIVE, true);

    expect(await findActiveSessionId()).toBeNull();
  });
});
