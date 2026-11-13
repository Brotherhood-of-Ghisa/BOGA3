import { __resetClockForTests } from '@/src/data/clock';
import {
  InjuryInputError,
  listInjuries,
  readInjury,
  removeInjury,
  resolveInjury,
  saveInjury,
  updateInjuryStatus,
  validateInjuryInput,
} from '@/src/data/injuries';
import { muscleGroups } from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: async () => mockFixture.database,
}));
jest.mock('@/src/sync/write-nudge', () => ({
  notifyLocalWrite: jest.fn(),
}));

describe('Injury validation', () => {
  const now = new Date(1730000000000);

  it('accepts valid minimal input', () => {
    const valid = validateInjuryInput({ label: 'Right knee tendonitis' }, now);
    expect(valid.label).toBe('Right knee tendonitis');
    expect(valid.status).toBe('acute');
    expect(valid.side).toBeNull();
    expect(valid.painScore).toBeNull();
    expect(valid.startedAt.getTime()).toBe(now.getTime());
    expect(valid.resolvedAt).toBeNull();
  });

  it('rejects blank label', () => {
    expect(() => validateInjuryInput({ label: '   ' }, now)).toThrow(InjuryInputError);
    expect(() => validateInjuryInput({ label: '' }, now)).toThrow(InjuryInputError);
  });

  it('rejects excessively long label', () => {
    expect(() => validateInjuryInput({ label: 'a'.repeat(101) }, now)).toThrow(InjuryInputError);
  });

  it('validates status choices', () => {
    expect(validateInjuryInput({ label: 'Pain', status: 'managing' }, now).status).toBe('managing');
    expect(validateInjuryInput({ label: 'Pain', status: 'monitoring' }, now).status).toBe('monitoring');
    // @ts-expect-error invalid status
    expect(() => validateInjuryInput({ label: 'Pain', status: 'unknown' }, now)).toThrow(
      InjuryInputError
    );
  });

  it('validates side choices', () => {
    expect(validateInjuryInput({ label: 'Pain', side: 'left' }, now).side).toBe('left');
    expect(validateInjuryInput({ label: 'Pain', side: 'right' }, now).side).toBe('right');
    expect(validateInjuryInput({ label: 'Pain', side: 'bilateral' }, now).side).toBe('bilateral');
    // @ts-expect-error invalid side
    expect(() => validateInjuryInput({ label: 'Pain', side: 'front' }, now)).toThrow(
      InjuryInputError
    );
  });

  it('validates pain ratings 0-10', () => {
    expect(validateInjuryInput({ label: 'Pain', painScore: 0 }, now).painScore).toBe(0);
    expect(validateInjuryInput({ label: 'Pain', painScore: 10 }, now).painScore).toBe(10);
    expect(() => validateInjuryInput({ label: 'Pain', painScore: -1 }, now)).toThrow(
      InjuryInputError
    );
    expect(() => validateInjuryInput({ label: 'Pain', painScore: 11 }, now)).toThrow(
      InjuryInputError
    );
    expect(() => validateInjuryInput({ label: 'Pain', painScore: 5.5 }, now)).toThrow(
      InjuryInputError
    );
  });

  it('rejects startedAt in the future', () => {
    const future = new Date(now.getTime() + 60000);
    expect(() => validateInjuryInput({ label: 'Pain', startedAt: future }, now)).toThrow(
      InjuryInputError
    );
  });

  it('sets resolvedAt when resolved and checks boundaries', () => {
    const started = new Date(now.getTime() - 100000);
    const resolved = validateInjuryInput(
      { label: 'Pain', status: 'resolved', startedAt: started },
      now
    );
    expect(resolved.resolvedAt?.getTime()).toBe(now.getTime());

    const future = new Date(now.getTime() + 60000);
    expect(() =>
      validateInjuryInput({ label: 'Pain', status: 'resolved', resolvedAt: future }, now)
    ).toThrow(InjuryInputError);

    const beforeStarted = new Date(started.getTime() - 1000);
    expect(() =>
      validateInjuryInput(
        { label: 'Pain', status: 'resolved', startedAt: started, resolvedAt: beforeStarted },
        now
      )
    ).toThrow(InjuryInputError);
  });

  it('rejects oversized notes and contraindications', () => {
    expect(() => validateInjuryInput({ label: 'Pain', notes: 'a'.repeat(1001) }, now)).toThrow(
      InjuryInputError
    );
    expect(() =>
      validateInjuryInput({ label: 'Pain', contraindications: 'a'.repeat(501) }, now)
    ).toThrow(InjuryInputError);
  });
});

describe('Injury SQLite repository operations', () => {
  beforeEach(() => {
    __resetClockForTests();
    mockFixture = createInMemoryDatabase();
    // Seed muscle groups for testing relational join
    mockFixture.database
      .insert(muscleGroups)
      .values([
        { id: 'quads', displayName: 'Quadriceps', familyName: 'Legs', localDirty: false, localUpdatedAtMs: 0 },
        { id: 'chest', displayName: 'Chest', familyName: 'Chest', localDirty: false, localUpdatedAtMs: 0 },
      ])
      .onConflictDoNothing()
      .run();
  });

  afterEach(() => {
    mockFixture.close();
  });

  it('saves and reads an injury with muscle group relation', async () => {
    const now = new Date();
    const created = await saveInjury({
      label: 'Patellar tendon flare-up',
      muscleGroupId: 'quads',
      side: 'right',
      status: 'acute',
      painScore: 7,
      notes: 'Hurts during deep squats',
      contraindications: 'Heavy squats',
      now,
    });

    expect(created.id).toMatch(/^injury-/);
    expect(created.label).toBe('Patellar tendon flare-up');
    expect(created.muscleGroupId).toBe('quads');
    expect(created.muscleGroupName).toBe('Quadriceps');
    expect(created.side).toBe('right');
    expect(created.status).toBe('acute');
    expect(created.painScore).toBe(7);
    expect(created.notes).toBe('Hurts during deep squats');
    expect(created.contraindications).toBe('Heavy squats');

    const read = await readInjury(created.id);
    expect(read).not.toBeNull();
    expect(read?.id).toBe(created.id);
    expect(read?.muscleGroupName).toBe('Quadriceps');
  });

  it('updates an existing injury', async () => {
    const created = await saveInjury({
      label: 'Sprained wrist',
      side: 'left',
      status: 'acute',
      painScore: 8,
    });

    const updated = await saveInjury({
      id: created.id,
      label: 'Wrist sprain recovering',
      side: 'left',
      status: 'managing',
      painScore: 4,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.label).toBe('Wrist sprain recovering');
    expect(updated.status).toBe('managing');
    expect(updated.painScore).toBe(4);

    const reRead = await readInjury(created.id);
    expect(reRead?.status).toBe('managing');
  });

  it('throws on updating nonexistent injury', async () => {
    await expect(
      saveInjury({
        id: 'injury-non-existent',
        label: 'Imaginary pain',
      })
    ).rejects.toThrow(InjuryInputError);
  });

  it('lists active vs resolved injuries in priority order', async () => {
    const t0 = new Date(1730000000000);
    const t1 = new Date(1730000010000);
    const t2 = new Date(1730000020000);

    const monitoring = await saveInjury({
      label: 'Old ankle tweak',
      status: 'monitoring',
      startedAt: t2,
      now: t2,
    });
    const acute = await saveInjury({
      label: 'Fresh rotator cuff tear',
      status: 'acute',
      startedAt: t0,
      now: t2,
    });
    const managing = await saveInjury({
      label: 'Managing tennis elbow',
      status: 'managing',
      startedAt: t1,
      now: t2,
    });

    const active = await listInjuries({ status: 'active' });
    expect(active.map((i) => i.id)).toEqual([acute.id, managing.id, monitoring.id]);

    // Resolve an injury
    await resolveInjury(acute.id, t2);

    const activeAfterResolve = await listInjuries({ status: 'active' });
    expect(activeAfterResolve.map((i) => i.id)).toEqual([managing.id, monitoring.id]);

    const resolved = await listInjuries({ status: 'resolved' });
    expect(resolved.map((i) => i.id)).toEqual([acute.id]);
    expect(resolved[0].resolvedAt?.getTime()).toBe(t2.getTime());
  });

  it('updates lifecycle status and transitions resolvedAt cleanly', async () => {
    const created = await saveInjury({
      label: 'Groin strain',
      status: 'acute',
      painScore: 6,
    });

    const managed = await updateInjuryStatus(created.id, 'managing', { painScore: 3 });
    expect(managed.status).toBe('managing');
    expect(managed.painScore).toBe(3);
    expect(managed.resolvedAt).toBeNull();

    const resolved = await updateInjuryStatus(created.id, 'resolved', { painScore: 0 });
    expect(resolved.status).toBe('resolved');
    expect(resolved.painScore).toBe(0);
    expect(resolved.resolvedAt).not.toBeNull();

    // Reopening resolves back to active
    const reopened = await updateInjuryStatus(created.id, 'monitoring');
    expect(reopened.status).toBe('monitoring');
    expect(reopened.resolvedAt).toBeNull();
  });

  it('soft-deletes an injury', async () => {
    const created = await saveInjury({
      label: 'Bruised rib',
      status: 'managing',
    });

    await removeInjury(created.id);

    const read = await readInjury(created.id);
    expect(read).toBeNull();

    const all = await listInjuries({ status: 'all' });
    expect(all.find((i) => i.id === created.id)).toBeUndefined();
  });
});
