import { setImportedBodyWeightIgnored } from '@/src/health-import/bodyweight-actions';
import { bodyWeightMeasurements, syncRuntimeState } from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
let mockBootstrap: (() => Promise<InMemoryDatabaseFixture['database']>) | null = null;
let mockOwner: string | null = 'a';
jest.mock('@/src/auth/service', () => ({ getAuthSnapshot: () => ({ user: mockOwner ? { id: mockOwner } : null }) }));
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockBootstrap ? mockBootstrap() : mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));

const id = 'apple-health-weight:aaaaaaaa-1111-2222-3333-444444444444';
beforeEach(() => {
  mockFixture = createInMemoryDatabase(); mockOwner = 'a'; mockBootstrap = null;
  mockFixture.database.insert(syncRuntimeState).values({ id: 'primary', accountUserId: 'a' }).run();
  mockFixture.database.insert(bodyWeightMeasurements).values({ id, source: 'apple_health',
    externalId: 'aaaaaaaa-1111-2222-3333-444444444444', weightKg: 80, measuredAt: new Date(0) }).run();
});
afterEach(() => mockFixture.close());

it('rejects a delayed sheet action after the store has switched to another account', async () => {
  let finish!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  mockBootstrap = () => new Promise(resolve => { finish = () => resolve(mockFixture.database); began(); });
  const pending = setImportedBodyWeightIgnored(id, true, 'a');
  await started;
  mockOwner = 'b';
  mockFixture.database.update(syncRuntimeState).set({ accountUserId: 'b' }).run();
  finish();
  await expect(pending).rejects.toThrow('account changed');
  expect(mockFixture.database.select().from(bodyWeightMeasurements).get()).toMatchObject({ ignored: false, deletedAt: null });
});

it('applies inclusion to the same restored account and rejects an unowned store', async () => {
  await setImportedBodyWeightIgnored(id, true, 'a');
  expect(mockFixture.database.select().from(bodyWeightMeasurements).get()?.ignored).toBe(true);
  mockFixture.database.update(syncRuntimeState).set({ accountUserId: null }).run();
  await expect(setImportedBodyWeightIgnored(id, false, 'a')).rejects.toThrow('account changed');
});
