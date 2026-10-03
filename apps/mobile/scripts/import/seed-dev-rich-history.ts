#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  validateBogaSessionImportPackage,
  type BogaImportExerciseDecision,
  type BogaSessionImportPackage,
} from './boga-import-contract';
import {
  generatedBodyWeightMeasurementId,
  generatedExerciseDefinitionId,
  generatedExerciseMuscleMappingId,
  generatedSessionExerciseId,
  generatedSessionId,
  generatedSetId,
} from './boga-import-ids';
import {
  buildSystemCatalogEntities,
  countByType,
  pushEntities,
  pushUnique,
  required,
  signIn,
  sortByLayer,
  type WireEntity,
} from './dev-seed-sync';

type CliFlags = {
  input?: string;
  email?: string;
  password?: string;
  apiUrl?: string;
  anonKey?: string;
  dryRun: boolean;
  help: boolean;
};

const DEFAULT_INPUT = resolve(__dirname, 'fixtures/dev-rich-history.boga-import.json');
const DEFAULT_EMAIL = 'history@dev.local';
const DEFAULT_PASSWORD = 'dev123';

const parseCliFlags = (argv: string[]): CliFlags => {
  const flags: CliFlags = { dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--input':
        flags.input = next();
        break;
      case '--email':
        flags.email = next();
        break;
      case '--password':
        flags.password = next();
        break;
      case '--api-url':
        flags.apiUrl = next();
        break;
      case '--anon-key':
        flags.anonKey = next();
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
};

const printHelp = () => {
  console.log(`Seed BOGA dev rich history into local Supabase

Usage:
  npm run seed:dev-rich-history

Options:
  --input <json>       Defaults to scripts/import/fixtures/dev-rich-history.boga-import.json
  --email <email>      Defaults to history@dev.local
  --password <pass>    Defaults to dev123
  --api-url <url>      Defaults to API_URL or SUPABASE_URL
  --anon-key <key>     Defaults to ANON_KEY or SUPABASE_ANON_KEY
  --dry-run            Build and validate the wire graph without pushing it
`);
};

const epochMs = (value: string, label: string) => {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
  return ms;
};

const generatedExerciseIdForDecision = (pkg: BogaSessionImportPackage, decision: BogaImportExerciseDecision) =>
  decision.decision === 'map_existing'
    ? decision.exerciseDefinitionId
    : generatedExerciseDefinitionId(pkg, decision);

const buildWireEntities = (pkg: BogaSessionImportPackage): WireEntity[] => {
  const generatedAtMs = epochMs(pkg.generatedAt, 'generatedAt');
  const entities: WireEntity[] = [];
  const seen = new Set<string>();

  pushUnique(entities, seen, {
    type: 'user_settings',
    id: 'settings',
    client_updated_at_ms: generatedAtMs,
    fields: {
      bodyweight_calculations_enabled: pkg.bodyweightCalculationsEnabled,
      created_at: generatedAtMs,
      updated_at: generatedAtMs,
      deleted_at: null,
    },
  });

  for (const reading of pkg.bodyWeightMeasurements) {
    pushUnique(entities, seen, {
      type: 'body_weight_measurements',
      id: generatedBodyWeightMeasurementId(pkg, reading.id),
      client_updated_at_ms: generatedAtMs,
      fields: {
        weight_kg: reading.weightKg,
        measured_at: epochMs(reading.measuredAt, `${reading.id}.measuredAt`),
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });
  }

  for (const gym of pkg.target.catalogSnapshot.gyms) {
    pushUnique(entities, seen, {
      type: 'gyms',
      id: gym.id,
      client_updated_at_ms: generatedAtMs,
      fields: {
        name: gym.name,
        latitude: null,
        longitude: null,
        coordinate_accuracy_m: null,
        coordinates_updated_at: null,
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });
  }

  for (const entity of buildSystemCatalogEntities(generatedAtMs)) {
    pushUnique(entities, seen, entity);
  }

  for (const exercise of pkg.target.catalogSnapshot.exercises) {
    pushUnique(entities, seen, {
      type: 'exercise_definitions',
      id: exercise.id,
      client_updated_at_ms: generatedAtMs,
      fields: {
        name: exercise.name,
        load_input_mode: 'total_load',
        bodyweight_contribution: 0,
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });
  }

  for (const decision of pkg.exerciseDecisions) {
    if (decision.decision !== 'create_new') {
      continue;
    }
    const exerciseDefinitionId = generatedExerciseDefinitionId(pkg, decision);
    pushUnique(entities, seen, {
      type: 'exercise_definitions',
      id: exerciseDefinitionId,
      client_updated_at_ms: generatedAtMs,
      fields: {
        name: decision.exerciseName,
        load_input_mode: decision.loadInputMode,
        bodyweight_contribution: decision.bodyweightContribution,
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });

    for (const mapping of decision.muscleMappings) {
      pushUnique(entities, seen, {
        type: 'exercise_muscle_mappings',
        id: generatedExerciseMuscleMappingId(exerciseDefinitionId, mapping.muscleGroupId),
        client_updated_at_ms: generatedAtMs,
        fields: {
          exercise_definition_id: exerciseDefinitionId,
          muscle_group_id: mapping.muscleGroupId,
          weight: mapping.weight,
          role: mapping.role ?? null,
          created_at: generatedAtMs,
          updated_at: generatedAtMs,
          deleted_at: null,
        },
      });
    }
  }

  const decisionBySourceName = new Map(
    pkg.exerciseDecisions.map((decision) => [decision.sourceExerciseName, decision])
  );

  for (const session of pkg.sessions) {
    const sessionId = generatedSessionId(pkg, session);
    const startedAtMs = epochMs(session.startedAt, `${session.importSessionKey}.startedAt`);
    const completedAtMs = epochMs(session.completedAt, `${session.importSessionKey}.completedAt`);
    pushUnique(entities, seen, {
      type: 'sessions',
      id: sessionId,
      client_updated_at_ms: completedAtMs,
      fields: {
        gym_id: session.gymId,
        status: 'completed',
        started_at: startedAtMs,
        completed_at: completedAtMs,
        duration_sec: session.durationSec,
        created_at: startedAtMs,
        updated_at: completedAtMs,
        deleted_at: null,
      },
    });

    for (const exercise of session.exercises) {
      const decision = decisionBySourceName.get(exercise.sourceExerciseName);
      if (!decision) {
        throw new Error(`Missing exercise decision for ${exercise.sourceExerciseName}`);
      }
      const sessionExerciseId = generatedSessionExerciseId(sessionId, exercise);
      pushUnique(entities, seen, {
        type: 'session_exercises',
        id: sessionExerciseId,
        client_updated_at_ms: completedAtMs,
        fields: {
          session_id: sessionId,
          exercise_definition_id: generatedExerciseIdForDecision(pkg, decision),
          order_index: exercise.orderIndex,
          name: exercise.targetExercise.exerciseName,
          machine_name: null,
          created_at: startedAtMs,
          updated_at: completedAtMs,
          deleted_at: null,
        },
      });

      for (const set of exercise.sets) {
        pushUnique(entities, seen, {
          type: 'exercise_sets',
          id: generatedSetId(sessionExerciseId, set),
          client_updated_at_ms: completedAtMs,
          fields: {
            session_exercise_id: sessionExerciseId,
            order_index: set.orderIndex,
            weight_value: set.weightValue,
            reps_value: set.repsValue,
            set_type: set.setType,
            planned_weight_value: set.plannedWeightValue,
            planned_reps_value: set.plannedRepsValue,
            planned_set_type: set.plannedSetType,
            performance_status: set.performanceStatus,
            created_at: startedAtMs,
            updated_at: completedAtMs,
            deleted_at: null,
          },
        });
      }
    }
  }

  return entities;
};

export const runDevRichHistorySeedCli = async (argv: string[]) => {
  const flags = parseCliFlags(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const inputPath = flags.input ? resolve(flags.input) : DEFAULT_INPUT;
  const email = flags.email ?? DEFAULT_EMAIL;
  const password = flags.password ?? DEFAULT_PASSWORD;
  const apiUrl = flags.apiUrl ?? process.env.API_URL ?? process.env.SUPABASE_URL;
  const anonKey = flags.anonKey ?? process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!existsSync(inputPath)) {
    throw new Error(`Rich-history import JSON not found: ${inputPath}`);
  }

  const pkg = JSON.parse(readFileSync(inputPath, 'utf8')) as BogaSessionImportPackage;
  const validation = validateBogaSessionImportPackage(pkg);
  if (!validation.ok) {
    throw new Error(`Rich-history package is invalid:\n${validation.errors.join('\n')}`);
  }

  const entities = sortByLayer(buildWireEntities(pkg));
  const countsByType = countByType(entities);

  if (flags.dryRun) {
    console.log(JSON.stringify({ dryRun: true, input: inputPath, email, entities: entities.length, countsByType }, null, 2));
    return 0;
  }

  const { token } = await signIn(required(apiUrl, 'API_URL'), required(anonKey, 'ANON_KEY'), email, password);
  const pushed = await pushEntities(required(apiUrl, 'API_URL'), required(anonKey, 'ANON_KEY'), token, entities);

  console.log(JSON.stringify({ seeded: true, input: inputPath, email, pushed, countsByType }, null, 2));
  return 0;
};

if (require.main === module) {
  runDevRichHistorySeedCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[dev-rich-history-seed] ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
