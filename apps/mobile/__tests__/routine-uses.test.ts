/* eslint-disable import/first */
/** Real migrated SQLite: repeat uses never share performed identities or overwrite history. */
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import { applyMigrationBundle, createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { createBootstrapMockState } from './helpers/sync-cycle-mocks';

const mockBootstrapState = createBootstrapMockState<InMemoryDatabaseFixture['database']>();
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('./helpers/sync-cycle-mocks') as typeof import('./helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

import * as draftRepository from '@/src/data/session-drafts';
import { defaultSessionExerciseDraftClient, saveSessionExerciseDraft } from '@/src/session-recorder/session-exercise-draft';
import { __resetClockForTests } from '@/src/data/clock';
import { completeSessionDraft, loadSessionSnapshotById, persistSessionDraftSnapshot, reopenCompletedSessionDraft, updateSessionMetadata } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { repairRoutineUseClaimsForWirePage } from '@/src/data/session-plan-use-store';
import { mapDraftSnapshotToSession, toPersistDraftExercises } from '@/src/session-recorder/session-model';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessionPlanExercises, sessionPlanSets, sessionPlans, sessionPlanUses, sessions, trainingProgrammes } from '@/src/data/schema';
import { addPlanBlockToSession, autoCompletePlanBlocksForSession, listAvailablePlanBlocks, planFormFromDetail, planQueries, planRepository, savePlanEdits, skipPlanBlock, skipSessionPlanUse, startSessionPlan } from '@/src/session-planner';
import type { PlanDraft } from '@/src/session-planner/types';

const T0 = new Date('2026-11-06T09:00:00Z');
const T1 = new Date('2026-11-06T10:00:00Z');
const draft = (patch: Partial<PlanDraft> = {}): PlanDraft => ({
  title: 'Anytime', gymId: null, scheduledFor: T0, isRoutine: true,
  exercises: ['Squat', 'Bench'].map(name => ({
    exerciseDefinitionId: name, name,
    sets: [{ targetWeightText: '60', targetRepsText: '8', targetSetType: null }],
  })), ...patch,
});

let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database;
const createRoutine = async (patch: Partial<PlanDraft> = {}) => {
  const result = await planRepository.createPlan(draft(patch), T0);
  if (result.status !== 'saved') throw new Error('Fixture plan failed');
  return result.id;
};
const start = async (planId: string) => {
  const result = await startSessionPlan(planId, T0);
  if (result.status !== 'started') throw new Error(`Start failed: ${result.status}`);
  return result.sessionId;
};
const finishPartial = async (planId: string, completedAt = T1) => {
  const id = await start(planId);
  const snapshot = (await loadSessionSnapshotById(id))!;
  const block = snapshot.exercises[0];
  await persistSessionDraftSnapshot({ sessionId: id, gymId: null, startedAt: T0,
    exercises: [{ ...block, sets: [{ ...block.sets[0], weightValue: '61', repsValue: '6', performanceStatus: null }] }],
  });
  await completeSessionDraft(id, { completedAt });
  return id;
};

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  mockBootstrapState.database = fixture.database;
  db().insert(exerciseDefinitions).values(['Squat', 'Bench'].map(id => ({ id, name: id }))).run();
});
afterEach(() => { fixture.close(); mockBootstrapState.database = null; __resetClockForTests(); });

it('finishes partial work, then starts the entire prescription with new blank identities', async () => {
  const planId = await createRoutine();
  const firstId = await start(planId);
  const first = await loadSessionSnapshotById(firstId);
  const performed = first!.exercises[0];
  await persistSessionDraftSnapshot({
    sessionId: firstId, gymId: null, startedAt: T0,
    exercises: [{ ...performed, sets: [{ ...performed.sets[0], weightValue: '65', repsValue: '7', performanceStatus: null }] }],
  });
  await completeSessionDraft(firstId, { completedAt: T1 });
  expect(await autoCompletePlanBlocksForSession(firstId)).toEqual([]);
  const history = await loadSessionSnapshotById(firstId);
  const secondId = await start(planId);
  const second = await loadSessionSnapshotById(secondId);
  expect(secondId).not.toBe(firstId);
  expect(second!.sourcePlanUseId).not.toBe(history!.sourcePlanUseId);
  expect(second!.exercises.map(block => block.name)).toEqual(['Squat', 'Bench']);
  expect(second!.exercises.flatMap(block => block.sets).every(set =>
    set.weightValue === '' && set.repsValue === '' && set.performanceStatus === 'planned')).toBe(true);
  expect(second!.exercises[0].sets[0].plannedWeightValue).toBe('60');
  expect(await loadSessionSnapshotById(firstId)).toEqual(history);
  expect(db().select().from(sessionPlanUses).all().map(use => use.slotIndex)).toEqual([1, 2]);
  expect(db().select().from(sessionPlanExercises).all().every(block => block.progressStatus === 'pending')).toBe(true);
});

it('retries a Start without allocating another use and refuses an unrelated active workout', async () => {
  const planId = await createRoutine();
  const sessionId = await start(planId);
  expect(await startSessionPlan(planId)).toEqual({ status: 'already-active', sessionId });
  const otherId = await createRoutine();
  expect(await startSessionPlan(otherId)).toEqual({ status: 'active-conflict', activeSessionId: sessionId });
  expect(db().select().from(sessionPlanUses).all()).toHaveLength(1);
});

it('retains a skipped action across retries without creating performed rows', async () => {
  const planId = await createRoutine();
  expect(await skipSessionPlanUse(planId, 'skip-action', T0)).toEqual({ status: 'skipped', skippedAt: T0 });
  expect(await skipSessionPlanUse(planId, 'skip-action', T1)).toEqual({ status: 'skipped', skippedAt: T0 });
  expect(db().select().from(sessionPlanUses).all()).toHaveLength(1);
  expect(db().select().from(sessions).all()).toHaveLength(0);
  expect(db().select().from(sessionExercises).all()).toHaveLength(0);
  expect(db().select().from(exerciseSets).all()).toHaveLength(0);
  await start(planId);
  expect(db().select().from(sessionPlanUses).all().map(use => use.slotIndex)).toEqual([1, 2]);
});

it('guards active use from Skip and keeps its actuals and reservations after abandonment', async () => {
  const planId = await createRoutine();
  const sessionId = await start(planId);
  const before = await loadSessionSnapshotById(sessionId);
  expect(await skipSessionPlanUse(planId, 'blocked-skip', T1)).toEqual({ status: 'active-conflict', activeSessionId: sessionId });
  expect(await loadSessionSnapshotById(sessionId)).toEqual(before);
  await setSessionDeletedState(sessionId, true);
  await start(planId);
  expect(db().select().from(sessionPlanUses).all().map(use => use.slotIndex)).toEqual([1, 2]);
});

it('converts an attached standalone plan in place and resumes its block-only workout', async () => {
  const planId = await createRoutine({ isRoutine: false });
  const block = db().select().from(sessionPlanExercises).where(eq(sessionPlanExercises.sessionPlanId, planId)).all()[0];
  const attachment = await addPlanBlockToSession(block.id);
  if (attachment.status !== 'attached') throw new Error('Fixture attachment failed');
  const before = await loadSessionSnapshotById(attachment.sessionId);
  expect(await planRepository.updatePlanMeta(planId, { isRoutine: true })).toEqual({ status: 'updated' });
  expect(await startSessionPlan(planId)).toEqual({ status: 'already-active', sessionId: attachment.sessionId });
  expect(await skipSessionPlanUse(planId, 'blocked-skip')).toEqual({ status: 'active-conflict', activeSessionId: attachment.sessionId });
  expect(await loadSessionSnapshotById(attachment.sessionId)).toEqual(before);
  expect(db().select().from(sessionPlans).get()).toMatchObject({ id: planId, isRoutine: true, scheduledFor: T0 });
  await planRepository.updatePlanMeta(planId, { isRoutine: false });
  expect(db().select().from(sessionPlans).get()).toMatchObject({ id: planId, isRoutine: false, scheduledFor: T0 });
});

it('refuses programme membership in authoring and storage without partial changes', async () => {
  db().insert(trainingProgrammes).values({ id: 'programme', name: 'Programme' }).run();
  expect((await planRepository.createPlanInProgramme('programme', draft())).status).toBe('validation-failed');
  expect((await planRepository.createProgramme({ name: 'Invalid', description: '', plans: [draft(), draft()] })).status)
    .toBe('validation-failed');
  const ordinary = await planRepository.createPlanInProgramme('programme', draft({ isRoutine: false }));
  if (ordinary.status !== 'saved') throw new Error('Fixture child failed');
  const before = db().select().from(sessionPlans).all();
  expect((await planRepository.updatePlanMeta(ordinary.id, { title: 'Changed', isRoutine: true })).status).toBe('validation-failed');
  expect(() => db().update(sessionPlans).set({ isRoutine: true }).where(eq(sessionPlans.id, ordinary.id)).run())
    .toThrow(/session_plans_routine_standalone/);
  expect(db().select().from(sessionPlans).all()).toEqual(before);
  const routineId = await createRoutine();
  expect(() => db().update(sessionPlans).set({ programmeId: 'programme' }).where(eq(sessionPlans.id, routineId)).run())
    .toThrow(/session_plans_routine_standalone/);
});

it('upgrades linked history additively inside a transaction with foreign keys enabled', () => {
  const client = new Database(':memory:');
  try {
    applyMigrationBundle(client, { ...generatedMigrationBundle, journal: {
      entries: generatedMigrationBundle.journal.entries.filter(entry => entry.idx < 28),
    } });
    client.pragma('foreign_keys = ON');
    client.prepare("INSERT INTO exercise_definitions(id,name) VALUES ('definition','Squat')").run();
    client.prepare("INSERT INTO session_plans(id,title,scheduled_for) VALUES ('plan','Original',12345)").run();
    client.prepare("INSERT INTO session_plan_exercises(id,session_plan_id,exercise_definition_id,order_index,name,progress_status,resolved_at) VALUES ('block','plan','definition',0,'Squat','completed',2000)").run();
    client.prepare("INSERT INTO session_plan_sets(id,session_plan_exercise_id,order_index,target_reps) VALUES ('target','block',0,8)").run();
    client.prepare("INSERT INTO sessions(id,source_plan_id,status,started_at,completed_at) VALUES ('history','plan','completed',1000,2000)").run();
    client.prepare("INSERT INTO session_exercises(id,session_id,exercise_definition_id,source_plan_exercise_id,order_index,name) VALUES ('card','history','definition','block',0,'Squat')").run();
    client.prepare("INSERT INTO exercise_sets(id,session_exercise_id,source_plan_set_id,order_index,weight_value,reps_value) VALUES ('performed','card','target',0,'60','8')").run();
    client.transaction(() => applyMigrationBundle(client, { ...generatedMigrationBundle, journal: {
      entries: generatedMigrationBundle.journal.entries.filter(entry => entry.idx === 28),
    } }))();
    expect(client.prepare('SELECT id,title,scheduled_for,is_routine FROM session_plans').get())
      .toEqual({ id: 'plan', title: 'Original', scheduled_for: 12345, is_routine: 0 });
    expect(client.prepare(`SELECT s.source_plan_id,c.source_plan_exercise_id,e.source_plan_set_id,e.weight_value,e.reps_value
      FROM sessions s JOIN session_exercises c ON c.session_id=s.id JOIN exercise_sets e ON e.session_exercise_id=c.id`).get())
      .toEqual({ source_plan_id: 'plan', source_plan_exercise_id: 'block', source_plan_set_id: 'target', weight_value: '60', reps_value: '8' });
    expect(client.pragma('foreign_key_check')).toEqual([]);
    expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
  } finally { client.close(); }
});

it.each(['workout', 'skip'] as const)('preserves work after losing a slot to %s, including a later save of an open recorder', async kind => {
  const planId = await createRoutine();
  const previousId = await start(planId);
  await completeSessionDraft(previousId, { completedAt: T1 });
  const previous = await loadSessionSnapshotById(previousId);
  const losingId = await start(planId);
  const stale = (await loadSessionSnapshotById(losingId))!;
  const recorder = mapDraftSnapshotToSession(stale);
  recorder.exercises[0].sets[0].weight = '91';
  recorder.exercises[0].sets[0].reps = '3';
  const winner = {
    type: 'session_plan_uses', id: 'server-winner', client_updated_at_ms: Date.now() + 1,
    fields: { session_plan_id: planId, slot_index: 2, kind, deleted_at: null },
  };
  await repairRoutineUseClaimsForWirePage([winner]);
  db().insert(sessionPlanUses).values({ id: winner.id, sessionPlanId: planId, slotIndex: 2, kind }).run();
  await persistSessionDraftSnapshot({
    sessionId: losingId, gymId: null, startedAt: T0,
    sourcePlanId: stale.sourcePlanId, sourcePlanUseId: stale.sourcePlanUseId,
    exercises: toPersistDraftExercises(recorder),
  });
  const preserved = await loadSessionSnapshotById(losingId);
  expect(preserved).toMatchObject({ sourcePlanId: null, sourcePlanUseId: null });
  expect(preserved!.exercises[0]).toMatchObject({ sourcePlanExerciseId: null, sourcePlanUseId: null });
  expect(preserved!.exercises[0].sets[0]).toMatchObject({
    weightValue: '91', repsValue: '3', sourcePlanSetId: null, sourcePlanUseId: null,
  });
  expect(await loadSessionSnapshotById(previousId)).toEqual(previous);
  expect(db().select().from(sessionPlanUses).where(eq(sessionPlanUses.id, stale.sourcePlanUseId!)).get()?.deletedAt).not.toBeNull();
});

it('keeps completion and Skip independent, derives dates from corrected history, and follows deletion/Undo/reopen', async () => {
  const planId = await createRoutine();
  const first = await finishPartial(planId);
  const later = new Date('2026-11-06T12:00:00Z');
  const second = await finishPartial(planId, later);
  await skipSessionPlanUse(planId, 'later-skip', new Date('2026-11-06T13:00:00Z'));
  const read = async () => (await planQueries.loadPlanDetail(planId))!.routine!;
  expect(await read()).toMatchObject({ lastCompletedAt: later, lastSkippedAt: new Date('2026-11-06T13:00:00Z') });
  const corrected = new Date('2026-11-06T09:30:00Z');
  await updateSessionMetadata(second, { times: { startedAt: T0, completedAt: corrected } });
  expect((await read()).lastCompletedAt).toEqual(T1);
  await setSessionDeletedState(first, true);
  expect((await read()).lastCompletedAt).toEqual(corrected);
  await setSessionDeletedState(first, false);
  expect((await read()).lastCompletedAt).toEqual(T1);
  await reopenCompletedSessionDraft(first);
  expect(await read()).toMatchObject({ activeSessionId: first, lastCompletedAt: corrected });
  await setSessionDeletedState(first, true);
  expect(await read()).toMatchObject({ activeSessionId: null, lastCompletedAt: corrected });
});

it('edits only future targets and keeps outcomes linked through tombstoned authored blocks', async () => {
  const planId = await createRoutine();
  const historyId = await finishPartial(planId);
  const history = await loadSessionSnapshotById(historyId);
  const activeId = await start(planId);
  const active = await loadSessionSnapshotById(activeId);
  const detail = (await planQueries.loadPlanDetail(planId))!;
  const form = planFormFromDetail(detail);
  form.blocks = [form.blocks[1]];
  form.blocks[0].sets[0].targetWeightText = '77';
  expect(await savePlanEdits(planId, form)).toEqual({ status: 'updated' });
  expect(await loadSessionSnapshotById(historyId)).toEqual(history);
  expect(await loadSessionSnapshotById(activeId)).toEqual(active);
  expect((await planQueries.loadPlanDetail(planId))!.routine!.lastCompletedAt).toEqual(T1);
  await setSessionDeletedState(activeId, true);
  const next = (await loadSessionSnapshotById(await start(planId)))!;
  expect(next.exercises.map(block => block.name)).toEqual(['Bench']);
  expect(next.exercises[0].sets[0]).toMatchObject({ plannedWeightValue: '77', weightValue: '', performanceStatus: 'planned' });
});

it('refuses a stale Routine edit atomically and retains the submitted fields', async () => {
  const planId = await createRoutine();
  const form = planFormFromDetail((await planQueries.loadPlanDetail(planId))!);
  form.title = 'My unsaved title';
  form.blocks[0].sets[0].targetWeightText = '99';
  await planRepository.updatePlanMeta(planId, { title: 'Other device title' });
  const beforeTargets = db().select().from(sessionPlanSets).all();
  expect(await savePlanEdits(planId, form)).toEqual({ status: 'stale-edit' });
  expect(db().select().from(sessionPlans).get()?.title).toBe('Other device title');
  expect(db().select().from(sessionPlanSets).all()).toEqual(beforeTargets);
  expect(form.title).toBe('My unsaved title');
  expect(form.blocks[0].sets[0].targetWeightText).toBe('99');
});

it('converts an already consumed plan without rewriting any source rows', async () => {
  const planId = await createRoutine({ isRoutine: false });
  await finishPartial(planId);
  const blocks = db().select().from(sessionPlanExercises).all();
  const targets = db().select().from(sessionPlanSets).all();
  const form = planFormFromDetail((await planQueries.loadPlanDetail(planId))!);
  form.isRoutine = true;
  expect(await savePlanEdits(planId, form)).toEqual({ status: 'updated' });
  expect(db().select().from(sessionPlanExercises).all()).toEqual(blocks);
  expect(db().select().from(sessionPlanSets).all()).toEqual(targets);
  expect((await planQueries.loadPlanDetail(planId))!.routine!.lastCompletedAt).toEqual(T1);
  await start(planId);
});

it.each([true, false])('preserves an entirely skipped legacy outcome and its known-date state (%s)', async hasDate => {
  const planId = await createRoutine({ isRoutine: false });
  for (const block of db().select().from(sessionPlanExercises).all()) await skipPlanBlock(block.id, T1);
  if (!hasDate) db().update(sessionPlanExercises).set({ resolvedAt: null }).run();
  await planRepository.updatePlanMeta(planId, { isRoutine: true });
  const expected = hasDate ? T1 : null;
  expect((await planQueries.loadPlanDetail(planId))!.routine!.lastSkippedAt).toEqual(expected);
  const form = planFormFromDetail((await planQueries.loadPlanDetail(planId))!);
  form.blocks = [form.blocks[0]];
  form.blocks[0].sets[0].targetRepsText = '3';
  expect(await savePlanEdits(planId, form)).toEqual({ status: 'updated' });
  expect((await planQueries.loadPlanDetail(planId))!.routine!.lastSkippedAt).toEqual(expected);
  await planRepository.updatePlanMeta(planId, { isRoutine: false });
  await planRepository.updatePlanMeta(planId, { isRoutine: true });
  expect(db().select().from(sessionPlanUses).all()).toHaveLength(1);
});

it('keeps a known completion with a missing date, and excludes manual-only work', async () => {
  const planId = await createRoutine();
  const id = await finishPartial(planId);
  db().update(sessions).set({ completedAt: null }).where(eq(sessions.id, id)).run();
  expect((await planQueries.loadPlanDetail(planId))!.routine!.lastCompletedAt).toBeNull();
  db().update(exerciseSets).set({ sourcePlanSetId: null, sourcePlanUseId: null }).run();
  const summary = (await planQueries.loadPlanDetail(planId))!.routine!;
  expect(summary.lastCompletedAt).toBeUndefined();
  expect(summary.hasKnownUse).toBe(true);
});

it('keeps Anytime out of due and picker queues, and restores its retained schedule when switched off', async () => {
  const planId = await createRoutine();
  expect(await planQueries.listUpcomingPlans()).toEqual([]);
  expect(await planQueries.listUnscheduledPlans()).toEqual([]);
  expect(await listAvailablePlanBlocks()).toEqual([]);
  expect((await planQueries.listRoutines()).map(plan => plan.id)).toEqual([planId]);
  const block = db().select().from(sessionPlanExercises).get()!;
  expect(await addPlanBlockToSession(block.id)).toEqual({ status: 'block-not-available' });
  await planRepository.updatePlanMeta(planId, { isRoutine: false });
  expect((await planQueries.listUpcomingPlans())[0]).toMatchObject({ id: planId, scheduledFor: T0 });
  expect(await planQueries.listRoutines()).toEqual([]);
});


it('remembers a converted one-off use after deleting its history without retaining its completion date', async () => {
  const planId = await createRoutine({ isRoutine: false });
  const completed = await finishPartial(planId);
  await planRepository.updatePlanMeta(planId, { isRoutine: true });
  await setSessionDeletedState(completed, true);
  const summary = (await planQueries.loadPlanDetail(planId))!.routine!;
  expect(summary.hasKnownUse).toBe(true);
  expect(summary.lastCompletedAt).toBeUndefined();
});


it('refuses an incomplete Routine start without silently dropping an unmapped block', async () => {
  const planId = await createRoutine();
  db().update(sessionPlanExercises).set({ exerciseDefinitionId: null }).where(eq(sessionPlanExercises.name, 'Squat')).run();
  expect(await startSessionPlan(planId)).toEqual({ status: 'unmapped-blocks' });
  expect(db().select().from(sessions).all()).toEqual([]);
  expect(db().select().from(sessionPlanUses).all()).toEqual([]);
});

it('resolves ordinary blocks on Finish beside reusable blocks and resumes a switched-off active use', async () => {
  const routine = await createRoutine(), ordinary = await createRoutine({ isRoutine: false });
  const id = await start(routine);
  await planRepository.updatePlanMeta(routine, { isRoutine: false });
  const ownBlock = (await planQueries.loadPlanDetail(routine))!.blocks[0];
  const opened = (await loadSessionSnapshotById(id))!;
  expect(await addPlanBlockToSession(ownBlock.id)).toMatchObject({ status: 'attached', sessionId: id,
    sessionExerciseId: opened.exercises[0].id });
  const ordinaryBlock = (await planQueries.loadPlanDetail(ordinary))!.blocks[0];
  expect((await addPlanBlockToSession(ordinaryBlock.id)).status).toBe('attached');
  const graph = (await loadSessionSnapshotById(id))!;
  await persistSessionDraftSnapshot({ sessionId: id, gymId: null, startedAt: T0,
    exercises: graph.exercises.map(card => ({ ...card, sets: card.sets.map(set => ({ ...set,
      weightValue: '72', repsValue: '5', performanceStatus: null })) })),
  });
  await completeSessionDraft(id, { completedAt: T1 });
  expect(await autoCompletePlanBlocksForSession(id, { sourcedBlockIds: graph.exercises.map(card => card.sourcePlanExerciseId!), now: T1 }))
    .toEqual([ordinaryBlock.id]);
  expect(db().select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, ownBlock.id)).get()!.progressStatus).toBe('pending');
  expect(db().select().from(sessionPlanExercises).where(eq(sessionPlanExercises.id, ordinaryBlock.id)).get()!.progressStatus).toBe('completed');
});

const loseFirstUse = async (planId: string) => repairRoutineUseClaimsForWirePage([{
  type: 'session_plan_uses', id: 'remote-skip', client_updated_at_ms: Date.now() + 1,
  fields: { session_plan_id: planId, slot_index: 1, kind: 'skip', deleted_at: null },
}]);

it('does not revive losing Routine provenance when an ordinary block append was prepared before sync repair', async () => {
  const routine = await createRoutine(), ordinary = await createRoutine({ isRoutine: false });
  const id = await start(routine);
  const source = (await planQueries.loadPlanDetail(ordinary))!.blocks[0];
  const original = draftRepository.persistSessionDraftSnapshot;
  const write = jest.spyOn(draftRepository, 'persistSessionDraftSnapshot').mockImplementationOnce(async (input, options) => {
    await loseFirstUse(routine);
    return original(input, options);
  });
  try { expect((await addPlanBlockToSession(source.id)).status).toBe('attached'); }
  finally { write.mockRestore(); }
  const result = (await loadSessionSnapshotById(id))!;
  expect(result).toMatchObject({ sourcePlanId: null, sourcePlanUseId: null });
  expect(result.exercises[0]).toMatchObject({ sourcePlanExerciseId: null, sourcePlanUseId: null });
  expect(result.exercises[0].sets[0]).toMatchObject({ sourcePlanSetId: null, sourcePlanUseId: null });
  expect(result.exercises.at(-1)!.sourcePlanExerciseId).toBe(source.id);
});

it('does not revive a losing root link when an exercise-page save races sync repair', async () => {
  const routine = await createRoutine(), id = await start(routine);
  const opened = (await loadSessionSnapshotById(id))!;
  const card = opened.exercises[0];
  await saveSessionExerciseDraft(id, { sessionExerciseId: card.id, sessionStatus: 'active',
    exercise: { ...card, sets: [{ ...card.sets[0], weightValue: '89', repsValue: '4', performanceStatus: null }] },
  }, { ...defaultSessionExerciseDraftClient,
    persistSessionDraftSnapshot: async (input, options) => {
      await loseFirstUse(routine);
      return persistSessionDraftSnapshot(input, options);
    },
  });
  const retained = (await loadSessionSnapshotById(id))!;
  expect(retained).toMatchObject({ sourcePlanId: null, sourcePlanUseId: null });
  expect(retained.exercises[0].sets[0]).toMatchObject({ weightValue: '89', repsValue: '4', sourcePlanSetId: null, sourcePlanUseId: null });
});
