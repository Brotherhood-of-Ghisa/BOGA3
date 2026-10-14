import wave from '../fixtures/rm-curve-weekly-wave.json';
import { EMPTY_SESSION_WEIGHT } from '@/src/bodyweight/as-of';
import type { RmCurveGraph } from '@/src/data/rm-curve';
import { personalLoadContext } from '@/src/exercise-calculations/analytics';
import type { InMemoryDatabaseFixture } from './in-memory-db';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';

/** Preserve the frozen inputs; split the third set into a repeated exercise block. */
export function waveGraph(scenario: keyof typeof wave.scenarios = 'plateau'): RmCurveGraph {
  return { definition: { id: 'curve', name: 'Synthetic exercise', loadInputMode: 'total_load' },
    rows: [...wave.prior, ...wave.scenarios[scenario]].map(set => ({
      ...EMPTY_SESSION_WEIGHT, setId: `${set.session}:${set.set}`, sessionId: set.session,
      sessionExerciseId: `${set.session}:block:${set.set === 3 ? 1 : 0}`,
      blockOrder: set.set === 3 ? 1 : 0, setOrder: set.set === 3 ? 0 : set.set - 1,
      startedAt: new Date(set.startedAt), completedAt: new Date(set.completedAt),
      gymId: set.gym, gymName: 'Synthetic gym', weightValue: set.weightValue,
      repsValue: set.repsValue, setType: set.setType, performanceStatus: set.performanceStatus,
      loadContext: personalLoadContext(false, { loadInputMode: 'total_load' }),
    })) };
}

/** Seed the same frozen graph through the current migrated schema. */
export function seedWaveHistory(database: InMemoryDatabaseFixture['database'], scenario: keyof typeof wave.scenarios = 'plateau') {
  const graph = waveGraph(scenario);
  database.insert(exerciseDefinitions).values(graph.definition).run();
  database.insert(gyms).values({ id: 'synthetic-gym', name: 'Synthetic gym' }).run();
  const seededSessions = new Set<string>(), blocks = new Set<string>();
  for (const row of graph.rows) {
    if (!seededSessions.has(row.sessionId)) {
      database.insert(sessions).values({ id: row.sessionId, startedAt: row.startedAt, completedAt: row.completedAt,
        status: 'completed', gymId: row.gymId }).run(); seededSessions.add(row.sessionId);
    }
    if (!blocks.has(row.sessionExerciseId)) {
      database.insert(sessionExercises).values({ id: row.sessionExerciseId, sessionId: row.sessionId,
        exerciseDefinitionId: graph.definition.id, name: graph.definition.name, orderIndex: row.blockOrder }).run(); blocks.add(row.sessionExerciseId);
    }
    database.insert(exerciseSets).values({ id: row.setId, sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.setOrder, weightValue: row.weightValue, repsValue: row.repsValue,
      setType: row.setType, performanceStatus: row.performanceStatus }).run();
  }
}
