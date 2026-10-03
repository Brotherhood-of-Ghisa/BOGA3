import {
  B_TRAINEE,
  HISTORY_TRAINEE,
  RECENT_WINDOW_DAYS,
  buildRecentSessionEntities,
  recentWindowStart,
  trainingDays,
} from '../scripts/import/seed-dev-groups';
import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';

// Saturday 3 Oct 2026, mid-morning local.
const NOW = new Date(2026, 9, 3, 10, 30);

describe('dev groups seed: recent training', () => {
  it('trains on the trainee weekdays inside the window, never today', () => {
    const days = trainingDays(NOW, [6]);

    expect(days.map((day) => day.getDate())).toEqual([5, 12, 19, 26]);
    expect(days.every((day) => day.getDay() === 6)).toBe(true);
    expect(days[0].getTime()).toBeGreaterThanOrEqual(recentWindowStart(NOW).getTime());
    expect(days.some((day) => day.toDateString() === NOW.toDateString())).toBe(false);
    expect(recentWindowStart(NOW)).toEqual(new Date(2026, 9, 3 - RECENT_WINDOW_DAYS));
  });

  it('keys each day by trainee and date, so a later run the same day pushes the same rows', () => {
    const morning = buildRecentSessionEntities(HISTORY_TRAINEE, NOW);
    const evening = buildRecentSessionEntities(HISTORY_TRAINEE, new Date(2026, 9, 3, 23, 0));

    expect(evening).toEqual(morning);
    const sessions = morning.filter((entity) => entity.type === 'sessions');
    expect(sessions).toHaveLength(12);
    expect(sessions[0].id).toBe('dev-recent-history-2026-09-07');
    expect(sessions[0].fields).toMatchObject({ status: 'completed', started_at: new Date(2026, 8, 7, 18).getTime() });
  });

  it('starts every session inside the window and links every row to its parent', () => {
    const entities = buildRecentSessionEntities(B_TRAINEE, NOW);
    const ids = new Set(entities.map((entity) => entity.id));

    for (const entity of entities) {
      if (entity.type === 'sessions') {
        expect(entity.fields.started_at as number).toBeGreaterThan(recentWindowStart(NOW).getTime());
      }
      if (entity.type === 'session_exercises') expect(ids.has(entity.fields.session_id as string)).toBe(true);
      if (entity.type === 'exercise_sets') expect(ids.has(entity.fields.session_exercise_id as string)).toBe(true);
    }
  });

  it('climbs a load step per week', () => {
    const entities = buildRecentSessionEntities(HISTORY_TRAINEE, NOW);
    // The first bench session (week 0) and the last (week 3).
    const firstSet = (date: string) => entities.find((entity) => entity.id === `dev-recent-history-${date}-e0-s0`);

    expect(firstSet('2026-09-07')?.fields.weight_value).toBe('80');
    expect(firstSet('2026-09-28')?.fields.weight_value).toBe('87.5');
  });

  it('logs only starter-catalog exercises, under their catalog names', () => {
    const catalog = new Map(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => [exercise.id, exercise.name]));

    for (const trainee of [HISTORY_TRAINEE, B_TRAINEE]) {
      for (const exercise of trainee.rotation.flat()) {
        expect(catalog.get(exercise.id)).toBe(exercise.name);
      }
    }
  });
});
