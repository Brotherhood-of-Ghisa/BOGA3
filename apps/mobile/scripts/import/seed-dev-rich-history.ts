#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '../../src/data/exercise-catalog-seeds';
import {
  validateBogaSessionImportPackage,
  type BogaImportExerciseDecision,
  type BogaSessionImportPackage,
} from './boga-import-contract';
import {
  generatedExerciseDefinitionId,
  generatedExerciseMuscleMappingId,
  generatedSessionExerciseId,
  generatedSessionId,
  generatedSetId,
} from './boga-import-ids';

type WireValue = string | number | boolean | null;

type WireEntity = {
  type:
    | 'gyms'
    | 'exercise_definitions'
    | 'muscle_groups'
    | 'exercise_muscle_mappings'
    | 'sessions'
    | 'session_exercises'
    | 'exercise_sets';
  id: string;
  client_updated_at_ms: number;
  fields: Record<string, WireValue>;
};

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
const BATCH_SIZE = 200;

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

const required = (value: string | undefined, label: string) => {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
};

const epochMs = (value: string, label: string) => {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
  return ms;
};

const pushUnique = (entities: WireEntity[], seen: Set<string>, entity: WireEntity) => {
  const key = `${entity.type}\0${entity.id}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  entities.push(entity);
};

const generatedExerciseIdForDecision = (pkg: BogaSessionImportPackage, decision: BogaImportExerciseDecision) =>
  decision.decision === 'map_existing'
    ? decision.exerciseDefinitionId
    : generatedExerciseDefinitionId(pkg, decision);

const buildWireEntities = (pkg: BogaSessionImportPackage): WireEntity[] => {
  const generatedAtMs = epochMs(pkg.generatedAt, 'generatedAt');
  const entities: WireEntity[] = [];
  const seen = new Set<string>();

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

  for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
    pushUnique(entities, seen, {
      type: 'muscle_groups',
      id: muscleGroup.id,
      client_updated_at_ms: generatedAtMs,
      fields: {
        display_name: muscleGroup.displayName,
        family_name: muscleGroup.familyName,
        sort_order: muscleGroup.sortOrder,
        is_editable: muscleGroup.isEditable,
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });
  }

  for (const exercise of [...SYSTEM_EXERCISE_DEFINITION_SEEDS, ...pkg.target.catalogSnapshot.exercises]) {
    pushUnique(entities, seen, {
      type: 'exercise_definitions',
      id: exercise.id,
      client_updated_at_ms: generatedAtMs,
      fields: {
        name: exercise.name,
        created_at: generatedAtMs,
        updated_at: generatedAtMs,
        deleted_at: null,
      },
    });
  }

  for (const mapping of SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS) {
    pushUnique(entities, seen, {
      type: 'exercise_muscle_mappings',
      id: mapping.id,
      client_updated_at_ms: generatedAtMs,
      fields: {
        exercise_definition_id: mapping.exerciseDefinitionId,
        muscle_group_id: mapping.muscleGroupId,
        weight: mapping.weight,
        role: mapping.role,
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
            planned_weight_value: null,
            planned_reps_value: null,
            planned_set_type: null,
            performance_status: null,
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

const signIn = async (apiUrl: string, anonKey: string, email: string, password: string) => {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== 'string') {
    throw new Error(`Sign-in failed for ${email}: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
};

const pushBatch = async (apiUrl: string, anonKey: string, token: string, batch: WireEntity[]) => {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/sync_push`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-profile': 'app_public',
      'content-profile': 'app_public',
    },
    body: JSON.stringify({ entities: batch }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`sync_push failed: HTTP ${response.status} ${body}`);
  }
};

const layerRank = (type: WireEntity['type']) => {
  switch (type) {
    case 'gyms':
    case 'exercise_definitions':
    case 'muscle_groups':
      return 0;
    case 'exercise_muscle_mappings':
    case 'sessions':
      return 1;
    case 'session_exercises':
      return 2;
    case 'exercise_sets':
      return 3;
  }
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

  const entities = buildWireEntities(pkg).sort((left, right) => layerRank(left.type) - layerRank(right.type));
  const countsByType = entities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    return counts;
  }, {});

  if (flags.dryRun) {
    console.log(JSON.stringify({ dryRun: true, input: inputPath, email, entities: entities.length, countsByType }, null, 2));
    return 0;
  }

  const token = await signIn(required(apiUrl, 'API_URL'), required(anonKey, 'ANON_KEY'), email, password);
  let pushed = 0;
  for (let index = 0; index < entities.length; index += BATCH_SIZE) {
    const batch = entities.slice(index, index + BATCH_SIZE);
    await pushBatch(required(apiUrl, 'API_URL'), required(anonKey, 'ANON_KEY'), token, batch);
    pushed += batch.length;
  }

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
