import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';

export type CuratedMovementSubstitute = {
  seedIdOrName: string;
  name: string;
  reason: string;
};

export type CuratedMovementMapping = {
  pattern: string;
  matches: (exerciseName: string) => boolean;
  substitutes: readonly CuratedMovementSubstitute[];
};

export const CURATED_SUBSTITUTIONS: readonly CuratedMovementMapping[] = [
  {
    pattern: 'squat',
    matches: (name: string) => /back squat|barbell squat|front squat/i.test(name),
    substitutes: [
      {
        seedIdOrName: 'seed_leg_press',
        name: 'Leg Press',
        reason: 'Removes axial spine load while training quads and glutes',
      },
      {
        seedIdOrName: 'seed_dumbbell_goblet_squats',
        name: 'Dumbbell Goblet Squats',
        reason: 'Upright torso reduces lower back stress',
      },
      {
        seedIdOrName: 'seed_machine_hack_squats',
        name: 'Machine Hack Squats',
        reason: 'Fixed plane of motion with back support',
      },
    ],
  },
  {
    pattern: 'bench_press',
    matches: (name: string) => /barbell bench press|incline barbell bench|flat barbell bench/i.test(name),
    substitutes: [
      {
        seedIdOrName: 'seed_dumbbell_bench_presses',
        name: 'Dumbbell Bench Presses',
        reason: 'Allows natural wrist rotation and elbow positioning',
      },
      {
        seedIdOrName: 'seed_machine_bench_presses',
        name: 'Machine Bench Presses',
        reason: 'Guided path minimizes shoulder stabilizer strain',
      },
      {
        seedIdOrName: 'seed_push-ups',
        name: 'Push-Ups',
        reason: 'Closed kinetic chain allows free scapular movement',
      },
    ],
  },
  {
    pattern: 'deadlift',
    matches: (name: string) => /barbell deadlift|conventional deadlift|sumo deadlift/i.test(name),
    substitutes: [
      {
        seedIdOrName: 'seed_trap_bar_deadlifts',
        name: 'Trap Bar Deadlifts',
        reason: 'Keeps center of gravity closer, reducing lumbar shear',
      },
      {
        seedIdOrName: 'seed_dumbbell_deadlifts',
        name: 'Dumbbell Deadlifts',
        reason: 'Lighter per-side load and adjustable hand placement',
      },
      {
        seedIdOrName: 'seed_romanian_deadlifts',
        name: 'Romanian Deadlifts',
        reason: 'Controlled hip hinge emphasizing hamstrings with lighter load',
      },
    ],
  },
  {
    pattern: 'overhead_press',
    matches: (name: string) => /overhead press|military press|barbell shoulder press/i.test(name),
    substitutes: [
      {
        seedIdOrName: 'seed_seated_machine_bench_presses',
        name: 'Seated Machine Overhead Press',
        reason: 'Limits lumbar hyperextension with back support',
      },
      {
        seedIdOrName: 'seed_dumbbell_neutral_press',
        name: 'Dumbbell Neutral-Grip Press',
        reason: 'Avoids shoulder impingement in acromial space',
      },
      {
        seedIdOrName: 'seed_dumbbell_shoulder_presses',
        name: 'Dumbbell Shoulder Presses',
        reason: 'Allows independent arm movement and natural path',
      },
    ],
  },
];

export type SubstitutionOption = {
  exercise: ExerciseCatalogExercise;
  isCurated: boolean;
  curatedReason?: string;
  matchType: 'curated' | 'primary_muscle' | 'secondary_muscle';
};

export type ExerciseSubstitutionsResult = {
  curated: SubstitutionOption[];
  alternatives: SubstitutionOption[];
  all: SubstitutionOption[];
};

type CurrentExerciseQuery = {
  id: string;
  name: string;
  mappings?: {
    muscleGroupId: string;
    role: 'primary' | 'secondary' | 'stabilizer' | null;
  }[];
};

function findCatalogExercise(
  substitute: CuratedMovementSubstitute,
  catalog?: readonly ExerciseCatalogExercise[]
): ExerciseCatalogExercise | null {
  const list = catalog ?? [];
  const byId = list.find((e) => e.id === substitute.seedIdOrName && !e.deletedAt);
  if (byId) return byId;

  const subNameLower = substitute.name.toLowerCase();
  const byExactName = list.find(
    (e) => e.name.toLowerCase() === subNameLower && !e.deletedAt
  );
  if (byExactName) return byExactName;

  const byFuzzyName = list.find(
    (e) => e.name.toLowerCase().includes(subNameLower) && !e.deletedAt
  );
  if (byFuzzyName) return byFuzzyName;

  return null;
}

/**
 * Resolves curated compound substitutions and primary muscle group alternatives for an active exercise.
 */
export function resolveExerciseSubstitutions(
  currentExercise: CurrentExerciseQuery,
  catalogExercises?: readonly ExerciseCatalogExercise[]
): ExerciseSubstitutionsResult {
  const catalogList = catalogExercises ?? [];
  const curated: SubstitutionOption[] = [];
  const alternatives: SubstitutionOption[] = [];
  const seenExerciseIds = new Set<string>([currentExercise.id]);

  // 1. Check curated mapping
  for (const mapping of CURATED_SUBSTITUTIONS) {
    if (mapping.matches(currentExercise.name)) {
      for (const substitute of mapping.substitutes) {
        const exercise = findCatalogExercise(substitute, catalogList);
        if (!exercise || exercise.id === currentExercise.id || seenExerciseIds.has(exercise.id)) {
          continue;
        }
        seenExerciseIds.add(exercise.id);
        curated.push({
          exercise,
          isCurated: true,
          curatedReason: substitute.reason,
          matchType: 'curated',
        });
      }
      break;
    }
  }

  // 2. Fallback: match primary muscle groups
  const primaryMuscleIds = (currentExercise.mappings ?? [])
    .filter((m) => m.role === 'primary')
    .map((m) => m.muscleGroupId);

  const fallbackMuscleIds =
    primaryMuscleIds.length > 0
      ? primaryMuscleIds
      : (currentExercise.mappings ?? [])
          .filter((m) => m.role === 'secondary')
          .map((m) => m.muscleGroupId);

  if (fallbackMuscleIds.length > 0) {
    for (const ex of catalogList) {
      if (ex.deletedAt || seenExerciseIds.has(ex.id)) continue;

      const hasPrimary = ex.mappings.some(
        (m) => m.role === 'primary' && fallbackMuscleIds.includes(m.muscleGroupId)
      );

      if (hasPrimary) {
        seenExerciseIds.add(ex.id);
        alternatives.push({
          exercise: ex,
          isCurated: false,
          matchType: 'primary_muscle',
        });
        continue;
      }

      const hasSecondary = ex.mappings.some(
        (m) => m.role === 'secondary' && fallbackMuscleIds.includes(m.muscleGroupId)
      );

      if (hasSecondary) {
        seenExerciseIds.add(ex.id);
        alternatives.push({
          exercise: ex,
          isCurated: false,
          matchType: 'secondary_muscle',
        });
      }
    }
  }

  return {
    curated,
    alternatives,
    all: [...curated, ...alternatives],
  };
}
