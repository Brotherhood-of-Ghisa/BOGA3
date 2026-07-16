#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SYSTEM_MUSCLE_GROUP_SEEDS } from '../../src/data/exercise-catalog-seeds';
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
  accessToken?: string;
  apiUrl?: string;
  anonKey?: string;
  confirmTarget?: string;
  dryRun: boolean;
  help: boolean;
};

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
      case '--access-token':
        flags.accessToken = next();
        break;
      case '--api-url':
        flags.apiUrl = next();
        break;
      case '--anon-key':
        flags.anonKey = next();
        break;
      case '--confirm-target':
        flags.confirmTarget = next();
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
  console.log(`Import BOGA session JSON into remote Supabase through sync_push

Usage:
  npm run import:boga-json:remote -- --input <boga-import.json> --dry-run

  npm run import:boga-json:remote -- --input <boga-import.json> \\
    --email <target-email> --password <password> \\
    --confirm-target "<package target label>"

Options:
  --input <json>             Import package produced by the digester
  --email <email>            Target user's Supabase auth email; required for writes
  --password <password>      Password used to obtain a user JWT
  --access-token <jwt>       Existing user JWT; alternative to password
  --api-url <url>            Defaults to API_URL or SUPABASE_URL
  --anon-key <key>           Defaults to ANON_KEY or SUPABASE_ANON_KEY
  --confirm-target <label>   Required for writes; must equal package target label
  --dry-run                  Build and validate the remote wire graph only
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

const requireCatalogGym = (pkg: BogaSessionImportPackage, gymId: string) => {
  const gym = pkg.target.catalogSnapshot.gyms.find((candidate) => candidate.id === gymId);
  if (!gym) {
    throw new Error(`Session references gym "${gymId}" but target.catalogSnapshot.gyms has no matching row`);
  }
  return gym;
};

export const buildRemoteImportWireEntities = (pkg: BogaSessionImportPackage): WireEntity[] => {
  const generatedAtMs = epochMs(pkg.generatedAt, 'generatedAt');
  const entities: WireEntity[] = [];
  const seen = new Set<string>();

  const referencedGymIds = new Set(pkg.sessions.map((session) => session.gymId).filter((gymId): gymId is string => !!gymId));
  for (const gymId of [...referencedGymIds].sort()) {
    const gym = requireCatalogGym(pkg, gymId);
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

  const createDecisions = pkg.exerciseDecisions.filter((decision) => decision.decision === 'create_new');
  const referencedMuscleGroupIds = new Set(
    createDecisions.flatMap((decision) => (decision.decision === 'create_new' ? decision.muscleMappings : [])).map(
      (mapping) => mapping.muscleGroupId
    )
  );
  const muscleSeedsById = new Map(SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => [seed.id, seed]));
  for (const muscleGroupId of [...referencedMuscleGroupIds].sort()) {
    const muscleGroup = muscleSeedsById.get(muscleGroupId);
    if (!muscleGroup) {
      throw new Error(`No bundled muscle group seed exists for "${muscleGroupId}"`);
    }
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

  for (const decision of createDecisions) {
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

  const decisionBySourceName = new Map(pkg.exerciseDecisions.map((decision) => [decision.sourceExerciseName, decision]));

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

const verifyTokenEmail = async (apiUrl: string, anonKey: string, token: string, expectedEmail: string) => {
  const response = await fetch(`${apiUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => null);
  const actualEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!response.ok || actualEmail === '') {
    throw new Error(`Could not verify target auth user: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  if (actualEmail !== expectedEmail.trim().toLowerCase()) {
    throw new Error(`Auth token belongs to "${actualEmail}", not expected target "${expectedEmail}"`);
  }
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

const countByType = (entities: WireEntity[]) =>
  entities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    return counts;
  }, {});

const requireWriteConfirmation = (pkg: BogaSessionImportPackage, flags: CliFlags) => {
  if (flags.confirmTarget !== pkg.target.importingProfileLabel) {
    throw new Error(
      `Write mode requires --confirm-target "${pkg.target.importingProfileLabel}" after reviewing dry-run output.`
    );
  }
};

export const runBogaJsonRemoteImportCli = async (argv: string[]) => {
  const flags = parseCliFlags(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const inputPath = resolve(required(flags.input, '--input'));
  if (!existsSync(inputPath)) {
    throw new Error(`BOGA import JSON not found: ${inputPath}`);
  }

  const pkg = JSON.parse(readFileSync(inputPath, 'utf8')) as BogaSessionImportPackage;
  const validation = validateBogaSessionImportPackage(pkg);
  if (!validation.ok) {
    throw new Error(`Import package is invalid:\n${validation.errors.join('\n')}`);
  }

  const entities = buildRemoteImportWireEntities(pkg).sort((left, right) => layerRank(left.type) - layerRank(right.type));
  const countsByType = countByType(entities);

  if (flags.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          input: inputPath,
          target: pkg.target.importingProfileLabel,
          sessions: pkg.sessions.length,
          entities: entities.length,
          countsByType,
        },
        null,
        2
      )
    );
    return 0;
  }

  requireWriteConfirmation(pkg, flags);
  const apiUrl = required(flags.apiUrl ?? process.env.API_URL ?? process.env.SUPABASE_URL, 'API_URL');
  const anonKey = required(flags.anonKey ?? process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY, 'ANON_KEY');
  const email = required(flags.email, '--email');
  const token =
    flags.accessToken ?? (await signIn(apiUrl, anonKey, email, required(flags.password, '--password')));
  await verifyTokenEmail(apiUrl, anonKey, token, email);

  let pushed = 0;
  for (let index = 0; index < entities.length; index += BATCH_SIZE) {
    const batch = entities.slice(index, index + BATCH_SIZE);
    await pushBatch(apiUrl, anonKey, token, batch);
    pushed += batch.length;
  }

  console.log(
    JSON.stringify(
      {
        imported: true,
        input: inputPath,
        target: pkg.target.importingProfileLabel,
        pushed,
        countsByType,
      },
      null,
      2
    )
  );
  return 0;
};

if (require.main === module) {
  runBogaJsonRemoteImportCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[boga-json-remote-import] ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
