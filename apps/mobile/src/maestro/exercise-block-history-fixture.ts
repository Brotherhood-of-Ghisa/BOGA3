import { inArray } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data';
import { exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const EXERCISE_BLOCK_HISTORY_FIXTURE = {
  gymId: 'maestro_exercise_block_history_gym',
  primaryExerciseId: 'sys_barbell_back_squat',
  primaryExerciseName: 'Barbell Back Squat',
  secondaryExerciseId: 'sys_barbell_bench_press',
  secondaryExerciseName: 'Barbell Bench Press',
  noHistoryExerciseId: 'sys_lat_pulldown',
  noHistoryExerciseName: 'Lat Pulldown',
} as const;

type FixtureSessionInput = {
  id: string;
  daysAgo: number;
  exerciseBlocks: {
    id: string;
    exerciseDefinitionId: string;
    name: string;
    orderIndex: number;
    sets: {
      id: string;
      orderIndex: number;
      weightValue: string;
      repsValue: string;
      setType: string | null;
    }[];
  }[];
};

export type ExerciseBlockHistoryFixtureRows = ReturnType<
  typeof buildExerciseBlockHistoryFixtureRows
>;

const completedAtForDaysAgo = (now: Date, daysAgo: number) =>
  new Date(now.getTime() - daysAgo * DAY_MS);

const sessionInputs: FixtureSessionInput[] = [
  {
    id: 'maestro_exercise_block_history_squat_1',
    daysAgo: 1,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_1_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_1_a_warm',
            orderIndex: 0,
            weightValue: '45',
            repsValue: '10',
            setType: 'warm_up',
          },
          {
            id: 'maestro_exercise_block_history_squat_1_a_work_1',
            orderIndex: 1,
            weightValue: '225',
            repsValue: '5',
            setType: 'rir_2',
          },
          {
            id: 'maestro_exercise_block_history_squat_1_a_work_2',
            orderIndex: 2,
            weightValue: '245',
            repsValue: '3',
            setType: 'rir_1',
          },
        ],
      },
      {
        id: 'maestro_exercise_block_history_squat_1_b',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 1,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_1_b_work_1',
            orderIndex: 0,
            weightValue: '255',
            repsValue: '2',
            setType: 'rir_0',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_squat_2',
    daysAgo: 4,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_2_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_2_a_work_1',
            orderIndex: 0,
            weightValue: '215',
            repsValue: '6',
            setType: 'rir_2',
          },
          {
            id: 'maestro_exercise_block_history_squat_2_a_work_2',
            orderIndex: 1,
            weightValue: '235',
            repsValue: '4',
            setType: null,
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_squat_3',
    daysAgo: 8,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_3_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_3_a_work_1',
            orderIndex: 0,
            weightValue: '205',
            repsValue: '8',
            setType: 'rir_2',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_squat_4',
    daysAgo: 12,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_4_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_4_a_work_1',
            orderIndex: 0,
            weightValue: '195',
            repsValue: '8',
            setType: null,
          },
          {
            id: 'maestro_exercise_block_history_squat_4_a_invalid',
            orderIndex: 1,
            weightValue: '',
            repsValue: '5',
            setType: 'rir_1',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_squat_5',
    daysAgo: 18,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_5_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_5_a_work_1',
            orderIndex: 0,
            weightValue: '185',
            repsValue: '10',
            setType: 'rir_2',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_squat_6_outside_limit',
    daysAgo: 26,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_squat_6_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_squat_6_a_work_1',
            orderIndex: 0,
            weightValue: '175',
            repsValue: '10',
            setType: 'rir_2',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_bench_1',
    daysAgo: 2,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_bench_1_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_bench_1_a_work_1',
            orderIndex: 0,
            weightValue: '155',
            repsValue: '8',
            setType: 'rir_2',
          },
        ],
      },
    ],
  },
  {
    id: 'maestro_exercise_block_history_bench_2',
    daysAgo: 9,
    exerciseBlocks: [
      {
        id: 'maestro_exercise_block_history_bench_2_a',
        exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId,
        name: EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseName,
        orderIndex: 0,
        sets: [
          {
            id: 'maestro_exercise_block_history_bench_2_a_work_1',
            orderIndex: 0,
            weightValue: '145',
            repsValue: '10',
            setType: null,
          },
        ],
      },
    ],
  },
];

export const buildExerciseBlockHistoryFixtureRows = (now: Date = new Date()) => {
  const gym = {
    id: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId,
    name: 'Maestro Block History Gym',
    latitude: null,
    longitude: null,
    coordinateAccuracyM: null,
    coordinatesUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const sessionRows = sessionInputs.map((session) => {
    const completedAt = completedAtForDaysAgo(now, session.daysAgo);
    return {
      id: session.id,
      gymId: gym.id,
      status: 'completed' as const,
      startedAt: new Date(completedAt.getTime() - 75 * MINUTE_MS),
      completedAt,
      durationSec: 75 * 60,
      deletedAt: null,
      createdAt: new Date(completedAt.getTime() - 75 * MINUTE_MS),
      updatedAt: completedAt,
    };
  });

  const sessionExerciseRows = sessionInputs.flatMap((session) => {
    const completedAt = completedAtForDaysAgo(now, session.daysAgo);
    return session.exerciseBlocks.map((block) => ({
      id: block.id,
      sessionId: session.id,
      exerciseDefinitionId: block.exerciseDefinitionId,
      orderIndex: block.orderIndex,
      name: block.name,
      machineName: null,
      createdAt: new Date(completedAt.getTime() - 75 * MINUTE_MS),
      updatedAt: completedAt,
    }));
  });

  const setRows = sessionInputs.flatMap((session) => {
    const completedAt = completedAtForDaysAgo(now, session.daysAgo);
    return session.exerciseBlocks.flatMap((block) =>
      block.sets.map((set) => ({
        id: set.id,
        sessionExerciseId: block.id,
        orderIndex: set.orderIndex,
        weightValue: set.weightValue,
        repsValue: set.repsValue,
        setType: set.setType,
        createdAt: new Date(completedAt.getTime() - 75 * MINUTE_MS),
        updatedAt: completedAt,
      }))
    );
  });

  return {
    gym,
    sessions: sessionRows,
    sessionExercises: sessionExerciseRows,
    exerciseSets: setRows,
  };
};

export const seedExerciseBlockHistoryFixture = async ({
  database,
  now = new Date(),
}: {
  database?: LocalDatabase;
  now?: Date;
} = {}) => {
  const targetDatabase = database ?? (await bootstrapLocalDataLayer());
  const rows = buildExerciseBlockHistoryFixtureRows(now);
  const sessionIds = rows.sessions.map((row) => row.id);
  const sessionExerciseIds = rows.sessionExercises.map((row) => row.id);
  const setIds = rows.exerciseSets.map((row) => row.id);

  targetDatabase.transaction((tx) => {
    tx.delete(exerciseSets).where(inArray(exerciseSets.id, setIds)).run();
    tx.delete(sessionExercises)
      .where(inArray(sessionExercises.id, sessionExerciseIds))
      .run();
    tx.delete(sessions).where(inArray(sessions.id, sessionIds)).run();
    tx.delete(gyms).where(inArray(gyms.id, [rows.gym.id])).run();

    tx.insert(gyms).values(rows.gym).run();
    tx.insert(sessions).values(rows.sessions).run();
    tx.insert(sessionExercises).values(rows.sessionExercises).run();
    tx.insert(exerciseSets).values(rows.exerciseSets).run();
  });

  return {
    ...EXERCISE_BLOCK_HISTORY_FIXTURE,
    sessionIds,
    sessionExerciseIds,
    setIds,
  };
};
