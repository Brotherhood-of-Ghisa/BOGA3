#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import {
  validateBogaSessionImportPackage,
  type BogaImportExerciseDecision,
  type BogaImportSession,
  type BogaImportSessionExercise,
  type BogaImportSet,
  type BogaImportWarning,
  type BogaSessionImportPackage,
} from './boga-import-contract';
import { nowMonotonic } from '../../src/data/clock';
import * as schema from '../../src/data/schema';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  gyms,
  muscleGroups,
  sessionExercises,
  sessions,
} from '../../src/data/schema';
import {
  generatedExerciseDefinitionId,
  generatedExerciseMuscleMappingId,
  generatedSessionExerciseId,
  generatedSessionId,
  generatedSetId,
} from './boga-import-ids';

export type BogaLocalImportDatabase = BetterSQLite3Database<typeof schema>;

export type BogaLocalImportOptions = {
  importingProfileLabel: string;
  localDatabasePath?: string;
  allowTargetMismatch?: boolean;
  fatalDurationWarnings?: boolean;
  dryRun?: boolean;
};

export type BogaLocalImportValidation = {
  ok: boolean;
  errors: string[];
};

export type BogaLocalImportReport = {
  target: {
    importingProfileLabel: string;
    localDatabasePath?: string;
    packageImportingProfileLabel: string;
    packageLocalDatabasePath?: string;
  };
  package: {
    schema: string;
    sourceApp: string;
    sourceExportSha256?: string;
    generatedAt: string;
  };
  tableRowCountsBefore: Record<
    | 'gyms'
    | 'exerciseDefinitions'
    | 'exerciseMuscleMappings'
    | 'sessions'
    | 'sessionExercises'
    | 'exerciseSets',
    number
  >;
  counts: {
    packageSessions: number;
    packageSessionExercises: number;
    packageExerciseSets: number;
    packageWarnings: number;
    fatalWarnings: number;
    gymsToInsert: number;
    exerciseDefinitionsToInsert: number;
    exerciseMuscleMappingsToInsert: number;
    sessionsToInsert: number;
    sessionExercisesToInsert: number;
    exerciseSetsToInsert: number;
    alreadyImportedSessions: number;
    alreadyImportedExerciseDefinitions: number;
    alreadyImportedExerciseMuscleMappings: number;
    gymsInserted: number;
    exerciseDefinitionsInserted: number;
    exerciseMuscleMappingsInserted: number;
    sessionsInserted: number;
    sessionExercisesInserted: number;
    exerciseSetsInserted: number;
  };
  warnings: BogaImportWarning[];
};

export type BogaLocalImportPlan = {
  validation: BogaLocalImportValidation;
  report: BogaLocalImportReport;
  rows: {
    exerciseDefinitions: {
      id: string;
      name: string;
      createdAt: Date;
      updatedAt: Date;
    }[];
    exerciseMuscleMappings: {
      id: string;
      exerciseDefinitionId: string;
      muscleGroupId: string;
      weight: number;
      role: 'primary' | 'secondary' | 'stabilizer' | null;
      createdAt: Date;
      updatedAt: Date;
    }[];
    sessions: {
      id: string;
      source: BogaImportSession;
      startedAt: Date;
      completedAt: Date;
    }[];
    sessionExercises: {
      id: string;
      sessionId: string;
      source: BogaImportSessionExercise;
      exerciseDefinitionId: string;
      createdAt: Date;
      updatedAt: Date;
    }[];
    exerciseSets: {
      id: string;
      sessionExerciseId: string;
      source: BogaImportSet;
      createdAt: Date;
      updatedAt: Date;
    }[];
  };
};

export type BogaLocalImportResult = BogaLocalImportPlan & {
  wrote: boolean;
};

type CliFlags = {
  input?: string;
  localDb?: string;
  importingProfileLabel?: string;
  confirmTarget?: string;
  dryRun: boolean;
  allowTargetMismatch: boolean;
  fatalDurationWarnings: boolean;
  help: boolean;
};

const EMPTY_INSERT_COUNTS = {
  gymsInserted: 0,
  exerciseDefinitionsInserted: 0,
  exerciseMuscleMappingsInserted: 0,
  sessionsInserted: 0,
  sessionExercisesInserted: 0,
  exerciseSetsInserted: 0,
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const parseIsoDate = (value: string, label: string, errors: string[]): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push(`${label} must be a valid ISO timestamp`);
  }
  return date;
};

const collectPackageWarnings = (pkg: BogaSessionImportPackage): BogaImportWarning[] => [
  ...(pkg.report?.warnings ?? []),
  ...pkg.exerciseDecisions.flatMap((decision) =>
    decision.decision === 'create_new' ? decision.warnings : []
  ),
  ...pkg.sessions.flatMap((session) => [
    ...session.warnings,
    ...session.exercises.flatMap((exercise) =>
      exercise.sets.flatMap((set) => set.warnings)
    ),
  ]),
];

const uniqueWarnings = (warnings: BogaImportWarning[]): BogaImportWarning[] => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}\0${warning.severity}\0${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const countTable = (database: BogaLocalImportDatabase, table: typeof gyms): number =>
  Number(database.select({ count: sql<number>`count(*)` }).from(table).get()?.count ?? 0);

const tableRowCounts = (database: BogaLocalImportDatabase): BogaLocalImportReport['tableRowCountsBefore'] => ({
  gyms: countTable(database, gyms),
  exerciseDefinitions: countTable(database, exerciseDefinitions as unknown as typeof gyms),
  exerciseMuscleMappings: countTable(database, exerciseMuscleMappings as unknown as typeof gyms),
  sessions: countTable(database, sessions as unknown as typeof gyms),
  sessionExercises: countTable(database, sessionExercises as unknown as typeof gyms),
  exerciseSets: countTable(database, exerciseSets as unknown as typeof gyms),
});

const selectActiveGymIds = (database: BogaLocalImportDatabase, ids: string[]): Set<string> => {
  if (ids.length === 0) {
    return new Set();
  }
  return new Set(
    database
      .select({ id: gyms.id })
      .from(gyms)
      .where(and(inArray(gyms.id, ids), isNull(gyms.deletedAt)))
      .all()
      .map((row) => row.id)
  );
};

const selectActiveExerciseDefinitionIds = (
  database: BogaLocalImportDatabase,
  ids: string[]
): Set<string> => {
  if (ids.length === 0) {
    return new Set();
  }
  return new Set(
    database
      .select({ id: exerciseDefinitions.id })
      .from(exerciseDefinitions)
      .where(and(inArray(exerciseDefinitions.id, ids), isNull(exerciseDefinitions.deletedAt)))
      .all()
      .map((row) => row.id)
  );
};

const selectExerciseDefinitionsByIds = (
  database: BogaLocalImportDatabase,
  ids: string[]
): Map<string, { id: string; name: string; deletedAt: Date | null }> => {
  if (ids.length === 0) {
    return new Map();
  }
  return new Map(
    database
      .select({
        id: exerciseDefinitions.id,
        name: exerciseDefinitions.name,
        deletedAt: exerciseDefinitions.deletedAt,
      })
      .from(exerciseDefinitions)
      .where(inArray(exerciseDefinitions.id, ids))
      .all()
      .map((row) => [row.id, row])
  );
};

const selectMuscleGroupIds = (database: BogaLocalImportDatabase, ids: string[]): Set<string> => {
  if (ids.length === 0) {
    return new Set();
  }
  return new Set(
    database
      .select({ id: muscleGroups.id })
      .from(muscleGroups)
      .where(inArray(muscleGroups.id, ids))
      .all()
      .map((row) => row.id)
  );
};

const selectSessionIds = (database: BogaLocalImportDatabase, ids: string[]): Set<string> => {
  if (ids.length === 0) {
    return new Set();
  }
  return new Set(
    database
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.id, ids))
      .all()
      .map((row) => row.id)
  );
};

const selectMappingEdgeKeys = (
  database: BogaLocalImportDatabase,
  exerciseDefinitionIds: string[]
): Set<string> => {
  if (exerciseDefinitionIds.length === 0) {
    return new Set();
  }
  return new Set(
    database
      .select({
        exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
        muscleGroupId: exerciseMuscleMappings.muscleGroupId,
      })
      .from(exerciseMuscleMappings)
      .where(
        and(
          inArray(exerciseMuscleMappings.exerciseDefinitionId, exerciseDefinitionIds),
          isNull(exerciseMuscleMappings.deletedAt)
        )
      )
      .all()
      .map((row) => `${row.exerciseDefinitionId}\0${row.muscleGroupId}`)
  );
};

const ensureUnique = (label: string, values: string[], errors: string[]) => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
};

const normalizePath = (path: string) => resolve(path);

const validateTarget = (
  pkg: BogaSessionImportPackage,
  options: BogaLocalImportOptions,
  errors: string[]
) => {
  if (!isNonEmptyString(options.importingProfileLabel)) {
    errors.push('importingProfileLabel is required to confirm who is importing');
    return;
  }

  if (
    !options.allowTargetMismatch &&
    pkg.target.importingProfileLabel !== options.importingProfileLabel
  ) {
    errors.push(
      `target profile mismatch: package targets "${pkg.target.importingProfileLabel}" but selected target is "${options.importingProfileLabel}"`
    );
  }

  if (
    !options.allowTargetMismatch &&
    pkg.target.localDatabasePath &&
    options.localDatabasePath &&
    normalizePath(pkg.target.localDatabasePath) !== normalizePath(options.localDatabasePath)
  ) {
    errors.push(
      `target database mismatch: package targets "${pkg.target.localDatabasePath}" but selected database is "${options.localDatabasePath}"`
    );
  }
};

export const planBogaLocalImport = (
  database: BogaLocalImportDatabase,
  pkg: BogaSessionImportPackage,
  options: BogaLocalImportOptions
): BogaLocalImportPlan => {
  const errors = validateBogaSessionImportPackage(pkg).errors;
  validateTarget(pkg, options, errors);

  const warnings = uniqueWarnings(collectPackageWarnings(pkg));
  const fatalWarnings = warnings.filter(
    (warning) => options.fatalDurationWarnings && warning.code.startsWith('duration_')
  );
  for (const warning of fatalWarnings) {
    errors.push(`fatal warning ${warning.code}: ${warning.message}`);
  }

  ensureUnique(
    'importSessionKey',
    pkg.sessions.map((session) => session.importSessionKey),
    errors
  );
  ensureUnique(
    'exercise decision sourceExerciseName',
    pkg.exerciseDecisions.map((decision) => decision.sourceExerciseName),
    errors
  );

  const decisionBySourceName = new Map(
    pkg.exerciseDecisions.map((decision) => [decision.sourceExerciseName, decision])
  );
  const createExerciseIdByKey = new Map<string, string>();
  for (const decision of pkg.exerciseDecisions) {
    if (decision.decision === 'create_new') {
      if (createExerciseIdByKey.has(decision.importExerciseKey)) {
        errors.push(`duplicate importExerciseKey: ${decision.importExerciseKey}`);
      }
      createExerciseIdByKey.set(decision.importExerciseKey, generatedExerciseDefinitionId(pkg, decision));
    }
  }

  const nonNullGymIds = [...new Set(pkg.sessions.flatMap((session) => (session.gymId ? [session.gymId] : [])))];
  const existingGymIds = selectActiveGymIds(database, nonNullGymIds);
  for (const gymId of nonNullGymIds) {
    if (!existingGymIds.has(gymId)) {
      const sessionIndex = pkg.sessions.findIndex((session) => session.gymId === gymId);
      errors.push(`sessions[${sessionIndex}].gymId "${gymId}" does not exist in the target local database`);
    }
  }

  const mappedExerciseIds = pkg.exerciseDecisions.flatMap((decision) =>
    decision.decision === 'map_existing' ? [decision.exerciseDefinitionId] : []
  );
  const existingMappedExerciseIds = selectActiveExerciseDefinitionIds(database, mappedExerciseIds);
  for (const decision of pkg.exerciseDecisions) {
    if (decision.decision === 'map_existing' && !existingMappedExerciseIds.has(decision.exerciseDefinitionId)) {
      errors.push(
        `exercise decision "${decision.sourceExerciseName}" maps to missing exercise_definition id "${decision.exerciseDefinitionId}"`
      );
    }
  }

  const createExerciseIds = [...createExerciseIdByKey.values()];
  const existingCreatedExercises = selectExerciseDefinitionsByIds(database, createExerciseIds);
  const generatedExerciseRows: BogaLocalImportPlan['rows']['exerciseDefinitions'] = [];
  const generatedMappingRows: BogaLocalImportPlan['rows']['exerciseMuscleMappings'] = [];
  const requiredMuscleGroupIds = new Set<string>();

  const generatedAt = parseIsoDate(pkg.generatedAt, 'generatedAt', errors);

  for (const decision of pkg.exerciseDecisions) {
    if (decision.decision !== 'create_new') {
      continue;
    }
    const exerciseDefinitionId = createExerciseIdByKey.get(decision.importExerciseKey);
    if (!exerciseDefinitionId) {
      continue;
    }
    const existing = existingCreatedExercises.get(exerciseDefinitionId);
    if (existing) {
      if (existing.deletedAt !== null) {
        errors.push(`created exercise "${decision.exerciseName}" already exists but is deleted`);
      }
      if (existing.name !== decision.exerciseName) {
        errors.push(
          `created exercise id "${exerciseDefinitionId}" already exists as "${existing.name}", not "${decision.exerciseName}"`
        );
      }
    } else {
      generatedExerciseRows.push({
        id: exerciseDefinitionId,
        name: decision.exerciseName,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }

    const seenMappingMuscles = new Set<string>();
    for (const mapping of decision.muscleMappings) {
      if (seenMappingMuscles.has(mapping.muscleGroupId)) {
        errors.push(`duplicate muscle mapping for "${decision.exerciseName}" and muscle "${mapping.muscleGroupId}"`);
      }
      seenMappingMuscles.add(mapping.muscleGroupId);
      requiredMuscleGroupIds.add(mapping.muscleGroupId);
      if (!Number.isFinite(mapping.weight) || mapping.weight <= 0) {
        errors.push(`muscle mapping for "${decision.exerciseName}" has non-positive weight`);
      }
      generatedMappingRows.push({
        id: generatedExerciseMuscleMappingId(exerciseDefinitionId, mapping.muscleGroupId),
        exerciseDefinitionId,
        muscleGroupId: mapping.muscleGroupId,
        weight: mapping.weight,
        role: mapping.role ?? null,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }
  }

  const existingMuscleGroupIds = selectMuscleGroupIds(database, [...requiredMuscleGroupIds]);
  for (const muscleGroupId of requiredMuscleGroupIds) {
    if (!existingMuscleGroupIds.has(muscleGroupId)) {
      errors.push(`muscleGroupId "${muscleGroupId}" does not exist in the target local database`);
    }
  }

  const existingMappingEdges = selectMappingEdgeKeys(database, [
    ...new Set(generatedMappingRows.map((row) => row.exerciseDefinitionId)),
  ]);
  const mappingRowsToInsert = generatedMappingRows.filter(
    (row) => !existingMappingEdges.has(`${row.exerciseDefinitionId}\0${row.muscleGroupId}`)
  );

  const sessionIds = pkg.sessions.map((session) => generatedSessionId(pkg, session));
  ensureUnique('generated session id', sessionIds, errors);
  const existingSessionIds = selectSessionIds(database, sessionIds);

  const sessionRows: BogaLocalImportPlan['rows']['sessions'] = [];
  const sessionExerciseRows: BogaLocalImportPlan['rows']['sessionExercises'] = [];
  const setRows: BogaLocalImportPlan['rows']['exerciseSets'] = [];
  const generatedIds: string[] = [...createExerciseIds, ...generatedMappingRows.map((row) => row.id), ...sessionIds];

  pkg.sessions.forEach((session, sessionIndex) => {
    const startedAt = parseIsoDate(session.startedAt, `sessions[${sessionIndex}].startedAt`, errors);
    const completedAt = parseIsoDate(session.completedAt, `sessions[${sessionIndex}].completedAt`, errors);
    if (completedAt.getTime() < startedAt.getTime()) {
      errors.push(`sessions[${sessionIndex}].completedAt must be after startedAt`);
    }
    if (Math.round((completedAt.getTime() - startedAt.getTime()) / 1000) !== session.durationSec) {
      errors.push(`sessions[${sessionIndex}].durationSec must match completedAt - startedAt`);
    }

    const sessionId = sessionIds[sessionIndex];
    if (existingSessionIds.has(sessionId)) {
      return;
    }

    sessionRows.push({ id: sessionId, source: session, startedAt, completedAt });

    const orderIndexes = session.exercises.map((exercise) => exercise.orderIndex);
    ensureUnique(`session ${session.importSessionKey} exercise orderIndex`, orderIndexes.map(String), errors);

    for (const exercise of session.exercises) {
      if (!Number.isInteger(exercise.orderIndex) || exercise.orderIndex < 0) {
        errors.push(`session ${session.importSessionKey} exercise orderIndex must be a non-negative integer`);
      }

      const decision = decisionBySourceName.get(exercise.sourceExerciseName);
      if (!decision) {
        continue;
      }
      let exerciseDefinitionId: string | undefined;
      if (exercise.targetExercise.kind === 'existing') {
        exerciseDefinitionId = exercise.targetExercise.exerciseDefinitionId;
        if (decision.decision !== 'map_existing' || decision.exerciseDefinitionId !== exerciseDefinitionId) {
          errors.push(`session ${session.importSessionKey} exercise "${exercise.sourceExerciseName}" does not match its map_existing decision`);
        }
      } else {
        exerciseDefinitionId = createExerciseIdByKey.get(exercise.targetExercise.importExerciseKey);
        if (decision.decision !== 'create_new' || decision.importExerciseKey !== exercise.targetExercise.importExerciseKey) {
          errors.push(`session ${session.importSessionKey} exercise "${exercise.sourceExerciseName}" does not match its create_new decision`);
        }
      }

      if (!exerciseDefinitionId) {
        errors.push(`session ${session.importSessionKey} exercise "${exercise.sourceExerciseName}" has no resolved exercise definition id`);
        continue;
      }

      const sessionExerciseId = generatedSessionExerciseId(sessionId, exercise);
      generatedIds.push(sessionExerciseId);
      sessionExerciseRows.push({
        id: sessionExerciseId,
        sessionId,
        source: exercise,
        exerciseDefinitionId,
        createdAt: startedAt,
        updatedAt: completedAt,
      });

      const setOrderIndexes = exercise.sets.map((set) => set.orderIndex);
      ensureUnique(
        `session ${session.importSessionKey} exercise ${exercise.orderIndex} set orderIndex`,
        setOrderIndexes.map(String),
        errors
      );
      for (const set of exercise.sets) {
        if (!Number.isInteger(set.orderIndex) || set.orderIndex < 0) {
          errors.push(`session ${session.importSessionKey} set orderIndex must be a non-negative integer`);
        }
        const setId = generatedSetId(sessionExerciseId, set);
        generatedIds.push(setId);
        setRows.push({
          id: setId,
          sessionExerciseId,
          source: set,
          createdAt: startedAt,
          updatedAt: completedAt,
        });
      }
    }
  });

  ensureUnique('generated import row id', generatedIds, errors);

  const report: BogaLocalImportReport = {
    target: {
      importingProfileLabel: options.importingProfileLabel,
      ...(options.localDatabasePath ? { localDatabasePath: options.localDatabasePath } : {}),
      packageImportingProfileLabel: pkg.target.importingProfileLabel,
      ...(pkg.target.localDatabasePath ? { packageLocalDatabasePath: pkg.target.localDatabasePath } : {}),
    },
    package: {
      schema: pkg.schema,
      sourceApp: pkg.source.app,
      ...(pkg.source.exportFile.sha256 ? { sourceExportSha256: pkg.source.exportFile.sha256 } : {}),
      generatedAt: pkg.generatedAt,
    },
    tableRowCountsBefore: tableRowCounts(database),
    counts: {
      packageSessions: pkg.sessions.length,
      packageSessionExercises: pkg.sessions.reduce((sum, session) => sum + session.exercises.length, 0),
      packageExerciseSets: pkg.sessions.reduce(
        (sum, session) =>
          sum + session.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.length, 0),
        0
      ),
      packageWarnings: warnings.length,
      fatalWarnings: fatalWarnings.length,
      gymsToInsert: 0,
      exerciseDefinitionsToInsert: generatedExerciseRows.length,
      exerciseMuscleMappingsToInsert: mappingRowsToInsert.length,
      sessionsToInsert: sessionRows.length,
      sessionExercisesToInsert: sessionExerciseRows.length,
      exerciseSetsToInsert: setRows.length,
      alreadyImportedSessions: existingSessionIds.size,
      alreadyImportedExerciseDefinitions: existingCreatedExercises.size,
      alreadyImportedExerciseMuscleMappings: generatedMappingRows.length - mappingRowsToInsert.length,
      ...EMPTY_INSERT_COUNTS,
    },
    warnings,
  };

  return {
    validation: {
      ok: errors.length === 0,
      errors,
    },
    report,
    rows: {
      exerciseDefinitions: generatedExerciseRows,
      exerciseMuscleMappings: mappingRowsToInsert,
      sessions: sessionRows,
      sessionExercises: sessionExerciseRows,
      exerciseSets: setRows,
    },
  };
};

export const importBogaSessionPackageToLocalDb = (
  database: BogaLocalImportDatabase,
  pkg: BogaSessionImportPackage,
  options: BogaLocalImportOptions
): BogaLocalImportResult => {
  const plan = planBogaLocalImport(database, pkg, options);
  if (!plan.validation.ok) {
    return { ...plan, wrote: false };
  }
  if (options.dryRun) {
    return { ...plan, wrote: false };
  }

  const inserted = { ...EMPTY_INSERT_COUNTS };
  database.transaction((tx) => {
    for (const row of plan.rows.exerciseDefinitions) {
      tx.insert(exerciseDefinitions)
        .values({
          id: row.id,
          name: row.name,
          deletedAt: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      inserted.exerciseDefinitionsInserted += 1;
    }

    for (const row of plan.rows.exerciseMuscleMappings) {
      tx.insert(exerciseMuscleMappings)
        .values({
          id: row.id,
          exerciseDefinitionId: row.exerciseDefinitionId,
          muscleGroupId: row.muscleGroupId,
          weight: row.weight,
          role: row.role,
          deletedAt: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      inserted.exerciseMuscleMappingsInserted += 1;
    }

    for (const row of plan.rows.sessions) {
      tx.insert(sessions)
        .values({
          id: row.id,
          gymId: row.source.gymId,
          status: 'completed',
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          durationSec: row.source.durationSec,
          deletedAt: null,
          createdAt: row.startedAt,
          updatedAt: row.completedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      inserted.sessionsInserted += 1;
    }

    for (const row of plan.rows.sessionExercises) {
      tx.insert(sessionExercises)
        .values({
          id: row.id,
          sessionId: row.sessionId,
          exerciseDefinitionId: row.exerciseDefinitionId,
          orderIndex: row.source.orderIndex,
          name: row.source.targetExercise.exerciseName,
          machineName: null,
          deletedAt: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      inserted.sessionExercisesInserted += 1;
    }

    for (const row of plan.rows.exerciseSets) {
      tx.insert(exerciseSets)
        .values({
          id: row.id,
          sessionExerciseId: row.sessionExerciseId,
          orderIndex: row.source.orderIndex,
          weightValue: row.source.weightValue,
          repsValue: row.source.repsValue,
          setType: row.source.setType,
          deletedAt: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      inserted.exerciseSetsInserted += 1;
    }
  });

  return {
    ...plan,
    wrote: true,
    report: {
      ...plan.report,
      counts: {
        ...plan.report.counts,
        ...inserted,
      },
    },
  };
};

const parseCliFlags = (argv: string[]): CliFlags => {
  const flags: CliFlags = {
    dryRun: false,
    allowTargetMismatch: false,
    fatalDurationWarnings: false,
    help: false,
  };
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
      case '--local-db':
        flags.localDb = next();
        break;
      case '--importing-profile-label':
        flags.importingProfileLabel = next();
        break;
      case '--confirm-target':
        flags.confirmTarget = next();
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--allow-target-mismatch':
        flags.allowTargetMismatch = true;
        break;
      case '--fatal-duration-warnings':
        flags.fatalDurationWarnings = true;
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
  console.log(`BOGA JSON local SQLite importer

Usage:
  npm run import:boga-json:local -- --input <boga-import.json> --local-db <path-to-boga-sqlite> \\
    --importing-profile-label "<user/profile>" --dry-run

Write after reviewing dry-run:
  npm run import:boga-json:local -- --input <boga-import.json> --local-db <path-to-boga-sqlite> \\
    --importing-profile-label "<user/profile>" --confirm-target "<user/profile>"

Options:
  --fatal-duration-warnings   Treat duration_* package warnings as validation errors.
  --allow-target-mismatch     Allow profile/database metadata mismatch when deliberately importing elsewhere.

The importer is idempotent by default: rows are assigned deterministic IDs from
the import package, and already-imported sessions are reported instead of copied.
`);
};

const requireFlag = (value: string | undefined, label: string) => {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
};

export const runBogaLocalImportCli = (argv: string[]) => {
  const flags = parseCliFlags(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const inputPath = requireFlag(flags.input, '--input');
  const localDbPath = requireFlag(flags.localDb, '--local-db');
  const importingProfileLabel = requireFlag(flags.importingProfileLabel, '--importing-profile-label');

  if (!existsSync(localDbPath)) {
    throw new Error(`Local BOGA SQLite DB not found: ${localDbPath}`);
  }
  if (!flags.dryRun && flags.confirmTarget !== importingProfileLabel) {
    throw new Error(
      'Write mode requires --confirm-target with the exact --importing-profile-label value after reviewing dry-run output.'
    );
  }

  const parsed = JSON.parse(readFileSync(inputPath, 'utf8')) as BogaSessionImportPackage;
  const rawDb = new Database(localDbPath, { fileMustExist: true });
  rawDb.pragma('foreign_keys = ON');
  const database = drizzle(rawDb, { schema });
  try {
    const result = importBogaSessionPackageToLocalDb(database, parsed, {
      importingProfileLabel,
      localDatabasePath: localDbPath,
      allowTargetMismatch: flags.allowTargetMismatch,
      fatalDurationWarnings: flags.fatalDurationWarnings,
      dryRun: flags.dryRun,
    });
    console.log(
      JSON.stringify(
        {
          wrote: result.wrote,
          validation: result.validation,
          report: result.report,
        },
        null,
        2
      )
    );
    return result.validation.ok ? 0 : 1;
  } finally {
    rawDb.close();
  }
};

if (require.main === module) {
  try {
    process.exitCode = runBogaLocalImportCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[boga-json-local-importer] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
