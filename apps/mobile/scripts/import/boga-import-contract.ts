import { BOGA_SESSION_IMPORT_SCHEMA_V2, validateImportedSessionWeight, validateImportedSetMeaning,
  validateImportedWeightReading, validateImportedExerciseRules, type ImportedSessionWeight,
  type ImportedSetMeaning, type ImportedWeightReading, type ImportedExerciseRules } from './bodyweight-import-context';
export { BOGA_SESSION_IMPORT_SCHEMA_V2 } from './bodyweight-import-context';
import { isSessionSetType, type SessionSetTypeValue } from '../../src/data/set-types';

export const BOGA_SESSION_IMPORT_SCHEMA = 'boga.session-import.v1' as const;

export type BogaImportCatalogExercise = {
  id: string;
  name: string;
};

export type BogaImportCatalogGym = {
  id: string;
  name: string;
};

export type BogaImportCatalog = {
  exercises: BogaImportCatalogExercise[];
  gyms: BogaImportCatalogGym[];
};

export type BogaImportWarning = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type BogaImportExerciseDecision =
  | {
      sourceExerciseName: string;
      decision: 'map_existing';
      exerciseDefinitionId: string;
      exerciseName: string;
    }
  | {
      sourceExerciseName: string;
      decision: 'create_new';
      loadInputMode?: ImportedExerciseRules['loadInputMode'];
      loadRules?: ImportedExerciseRules['loadRules'];
      importExerciseKey: string;
      exerciseName: string;
      muscleMappings: {
        muscleGroupId: string;
        weight: number;
        role?: 'primary' | 'secondary' | 'stabilizer' | null;
      }[];
      warnings: BogaImportWarning[];
    };

export type BogaImportExerciseTarget =
  | {
      kind: 'existing';
      exerciseDefinitionId: string;
      exerciseName: string;
    }
  | {
      kind: 'create';
      importExerciseKey: string;
      exerciseName: string;
    };

export type BogaImportSetType = SessionSetTypeValue;

export type BogaImportSet = Partial<ImportedSetMeaning> & {
  orderIndex: number;
  repsValue: string;
  weightValue: string;
  setType: BogaImportSetType;
  source: {
    rowIndex: number;
    workoutName: string;
    exerciseName: string;
    loggedAtLocal: string;
    type: string;
    targetRegion: string;
    targetMusclesPrimary: string;
    targetMusclesSecondary: string;
    weightLoggedKg?: string;
    weightAdjustment?: 'two_sided_halved';
    note?: string;
  };
  warnings: BogaImportWarning[];
};

export type BogaImportSessionExercise = {
  orderIndex: number;
  sourceExerciseName: string;
  targetExercise: BogaImportExerciseTarget;
  sets: BogaImportSet[];
};

export type BogaImportSession = Partial<ImportedSessionWeight> & {
  importSessionKey: string;
  localDate: string;
  startedAt: string;
  completedAt: string;
  durationSec: number;
  rawSpanSec: number;
  gymId: string | null;
  gymBucket: 'midday' | 'weekday_evening' | 'weekend' | 'none';
  sourceWorkoutNames: string[];
  exercises: BogaImportSessionExercise[];
  warnings: BogaImportWarning[];
};

export type BogaSessionImportPackage = {
  schema: typeof BOGA_SESSION_IMPORT_SCHEMA | typeof BOGA_SESSION_IMPORT_SCHEMA_V2;
  bodyWeightMeasurements?: ImportedWeightReading[];
  generatedAt: string;
  target: {
    importingProfileLabel: string;
    localDatabasePath?: string;
    catalogSnapshot: BogaImportCatalog;
  };
  source: {
    app: string;
    exportFile: {
      path?: string;
      sizeBytes?: number;
      sha256?: string;
    };
    timezone: string;
    rowCount: number;
    skippedRowCount: number;
  };
  options: {
    sessionClusterGapMinutes: number;
    shortSessionThresholdMinutes: number;
    shortSessionDefaultDurationMinutes: number;
    longSessionWarningThresholdMinutes: number;
    dateStartLocal?: string;
    dateEndLocal?: string;
    enrichSetTypes?: boolean;
    halveWeightExercises?: string[];
    gymAssignments: {
      midday: string | null;
      weekdayEvening: string | null;
      weekend: string | null;
    };
  };
  exerciseDecisions: BogaImportExerciseDecision[];
  sessions: BogaImportSession[];
  report: {
    counts: {
      sourceRows: number;
      skippedRows: number;
      importedRows: number;
      inferredSessions: number;
      notesPreserved: number;
      unresolvedExercises: number;
      durationWarnings: number;
      dateFilteredRows?: number;
      weightsHalvedSets?: number;
    };
    weightHalvedExercises?: {
      sourceExerciseName: string;
      setCount: number;
    }[];
    unresolvedExercises: {
      sourceExerciseName: string;
      rowCount: number;
      sampleRows: number[];
    }[];
    gymAssignmentCounts: Record<string, number>;
    notes: {
      rowIndex: number;
      sourceExerciseName: string;
      note: string;
    }[];
    warnings: BogaImportWarning[];
  };
};

export type BogaImportValidationResult = {
  ok: boolean;
  errors: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

export const isValidBogaImportSetType = (value: unknown): value is BogaImportSetType =>
  value === null || isSessionSetType(value);

export const validateBogaSessionImportPackage = (
  value: unknown,
  options: { allowUnresolvedExercises?: boolean } = {}
): BogaImportValidationResult => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['package must be an object'] };
  }

  const v2 = value.schema === BOGA_SESSION_IMPORT_SCHEMA_V2;
  if (value.schema !== BOGA_SESSION_IMPORT_SCHEMA && !v2) {
    errors.push(`schema must be ${BOGA_SESSION_IMPORT_SCHEMA} or ${BOGA_SESSION_IMPORT_SCHEMA_V2}`);
  }

  if (!isString(value.generatedAt)) {
    errors.push('generatedAt must be an ISO string');
  }

  if (v2) {
    if (!Array.isArray(value.bodyWeightMeasurements)) errors.push('v2 requires a bodyWeightMeasurements array (empty is allowed)');
    else {
      const ids = new Set<string>();
      for (const reading of value.bodyWeightMeasurements) {
        if (!validateImportedWeightReading(reading)) { errors.push('Invalid body weight reading'); continue; }
        if (ids.has(reading.id)) errors.push('Duplicate body weight reading id');
        ids.add(reading.id);
        if (new Date(reading.measuredAt).getTime() > Date.now() || (typeof value.generatedAt === 'string' && new Date(reading.measuredAt).getTime() > new Date(value.generatedAt).getTime())) {
          errors.push('A reading cannot be later than the package generation time');
        }
      }
    }
  } else if (value.bodyWeightMeasurements !== undefined) errors.push('Body weight readings require the v2 schema');

  const target = value.target;
  if (!isRecord(target)) {
    errors.push('target must be an object');
  } else {
    if (!isString(target.importingProfileLabel) || target.importingProfileLabel.trim() === '') {
      errors.push('target.importingProfileLabel is required');
    }
    const catalog = target.catalogSnapshot;
    if (!isRecord(catalog) || !isArray(catalog.exercises) || !isArray(catalog.gyms)) {
      errors.push('target.catalogSnapshot must include exercises and gyms arrays');
    }
  }

  const source = value.source;
  if (!isRecord(source)) {
    errors.push('source must be an object');
  } else {
    if (!isString(source.app) || source.app.trim() === '') {
      errors.push('source.app is required');
    }
    if (!isString(source.timezone) || source.timezone.trim() === '') {
      errors.push('source.timezone is required');
    }
    if (!isNumber(source.rowCount)) {
      errors.push('source.rowCount must be a number');
    }
    if (!isNumber(source.skippedRowCount)) {
      errors.push('source.skippedRowCount must be a number');
    }
  }

  const decisions = value.exerciseDecisions;
  const decisionKeys = new Set<string>();
  if (!isArray(decisions)) {
    errors.push('exerciseDecisions must be an array');
  } else {
    for (const decision of decisions) {
      if (!isRecord(decision) || !isString(decision.sourceExerciseName)) {
        errors.push('each exercise decision must include sourceExerciseName');
        continue;
      }
      decisionKeys.add(decision.sourceExerciseName);
      if (decision.decision === 'map_existing') {
        if (!isString(decision.exerciseDefinitionId) || decision.exerciseDefinitionId.trim() === '') {
          errors.push(`exercise decision ${decision.sourceExerciseName} needs exerciseDefinitionId`);
        }
      } else if (decision.decision === 'create_new') {
        if (v2 && !validateImportedExerciseRules(decision)) errors.push(`exercise decision ${decision.sourceExerciseName} needs valid loadInputMode and loadRules`);
        if (!v2 && (decision.loadRules !== undefined || decision.loadInputMode !== undefined)) errors.push('Exercise load rules require the v2 schema');
        if (!isString(decision.importExerciseKey) || decision.importExerciseKey.trim() === '') {
          errors.push(`exercise decision ${decision.sourceExerciseName} needs importExerciseKey`);
        }
        if (!isArray(decision.muscleMappings)) {
          errors.push(`exercise decision ${decision.sourceExerciseName} needs muscleMappings array`);
        }
      } else {
        errors.push(`exercise decision ${decision.sourceExerciseName} has invalid decision`);
      }
    }
  }

  const report = value.report;
  if (isRecord(report) && isArray(report.unresolvedExercises)) {
    if (!options.allowUnresolvedExercises && report.unresolvedExercises.length > 0) {
      errors.push('report.unresolvedExercises must be empty for importer-ready packages');
    }
  }

  const sessions = value.sessions;
  if (!isArray(sessions)) {
    errors.push('sessions must be an array');
  } else {
    sessions.forEach((session, sessionIndex) => {
      if (!isRecord(session)) {
        errors.push(`sessions[${sessionIndex}] must be an object`);
        return;
      }
      if (v2 && !validateImportedSessionWeight(session)) errors.push(`sessions[${sessionIndex}] needs a complete valid bodyweight snapshot (or all null)`);
      if (!v2 && ['bodyWeightKg', 'bodyWeightSource', 'bodyWeightMeasurementId', 'bodyWeightMeasuredAt'].some(key => session[key] !== undefined)) errors.push('Session body weight requires the v2 schema');
      if (!isString(session.importSessionKey) || session.importSessionKey.trim() === '') {
        errors.push(`sessions[${sessionIndex}].importSessionKey is required`);
      }
      if (!isString(session.startedAt) || !isString(session.completedAt)) {
        errors.push(`sessions[${sessionIndex}] requires startedAt and completedAt`);
      }
      if (!isNumber(session.durationSec) || session.durationSec < 0) {
        errors.push(`sessions[${sessionIndex}].durationSec must be non-negative`);
      }
      if (!isArray(session.exercises) || session.exercises.length === 0) {
        errors.push(`sessions[${sessionIndex}].exercises must be non-empty`);
        return;
      }
      session.exercises.forEach((exercise, exerciseIndex) => {
        if (!isRecord(exercise)) {
          errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}] must be an object`);
          return;
        }
        if (!isString(exercise.sourceExerciseName) || !decisionKeys.has(exercise.sourceExerciseName)) {
          errors.push(
            `sessions[${sessionIndex}].exercises[${exerciseIndex}] references an exercise without a decision`
          );
        }
        const targetExercise = exercise.targetExercise;
        if (!isRecord(targetExercise)) {
          errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].targetExercise is required`);
        }
        if (!isArray(exercise.sets) || exercise.sets.length === 0) {
          errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].sets must be non-empty`);
        } else {
          exercise.sets.forEach((set, setIndex) => {
            if (!isRecord(set)) {
              errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}] must be an object`);
              return;
            }
            if (v2 && !validateImportedSetMeaning(set)) errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}] needs explicit actual/planned units, modes and performance status`);
            if (!v2 && ['weightUnit', 'externalLoadMode', 'plannedWeightUnit', 'plannedExternalLoadMode', 'performanceStatus'].some(key => set[key] !== undefined)) errors.push('Explicit set load meaning requires the v2 schema');
            const orderIndex = set.orderIndex;
            if (typeof orderIndex !== 'number' || !Number.isInteger(orderIndex) || orderIndex < 0) {
              errors.push(
                `sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}].orderIndex must be a non-negative integer`
              );
            }
            if (!isString(set.repsValue)) {
              errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}].repsValue must be a string`);
            }
            if (!isString(set.weightValue)) {
              errors.push(`sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}].weightValue must be a string`);
            }
            if (!isValidBogaImportSetType(set.setType)) {
              errors.push(
                `sessions[${sessionIndex}].exercises[${exerciseIndex}].sets[${setIndex}].setType must be warm_up, rir_<non-negative integer>, or null`
              );
            }
          });
        }
      });
    });
  }

  return { ok: errors.length === 0, errors };
};


/** Export the versioned package without dropping raw units, provenance or plans. */
export const serializeBogaSessionImportPackage = (pkg: BogaSessionImportPackage): string => {
  const validation = validateBogaSessionImportPackage(pkg);
  if (!validation.ok) throw new Error(validation.errors.join('\n'));
  return JSON.stringify(pkg, null, 2) + '\n';
};
