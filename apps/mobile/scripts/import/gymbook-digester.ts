#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { TextDecoder } from 'node:util';

import {
  BOGA_SESSION_IMPORT_SCHEMA,
  validateBogaSessionImportPackage,
  type BogaImportCatalog,
  type BogaImportExerciseDecision,
  type BogaImportExerciseTarget,
  type BogaImportSet,
  type BogaImportWarning,
  type BogaSessionImportPackage,
} from './boga-import-contract';

export type GymBookRawLog = {
  rowIndex: number;
  date: string;
  workout: string;
  time: string;
  exercise: string;
  targetRegion: string;
  targetMusclesPrimary: string;
  targetMusclesSecondary: string;
  type: string;
  reps: string;
  weight: string;
  notes: string;
  skipped: string;
};

type GymBucketChoices = {
  midday: string | null;
  weekdayEvening: string | null;
  weekend: string | null;
};

export type GymBookExerciseDecisionInput =
  | {
      decision: 'map_existing';
      exerciseDefinitionId: string;
    }
  | {
      decision: 'create_new';
      exerciseName?: string;
      importExerciseKey?: string;
      muscleMappings?: {
        muscleGroupId: string;
        weight: number;
        role?: 'primary' | 'secondary' | 'stabilizer' | null;
      }[];
    };

export type DigestGymBookOptions = {
  importingProfileLabel: string;
  catalog: BogaImportCatalog;
  sourceFile?: {
    path?: string;
    sizeBytes?: number;
    sha256?: string;
  };
  localDatabasePath?: string;
  timezone?: string;
  generatedAt?: Date;
  sessionClusterGapMinutes?: number;
  shortSessionThresholdMinutes?: number;
  shortSessionDefaultDurationMinutes?: number;
  longSessionWarningThresholdMinutes?: number;
  gymAssignments: GymBucketChoices;
  exerciseDecisions?: Record<string, GymBookExerciseDecisionInput>;
  allowUnresolvedExercises?: boolean;
};

type ParsedLog = GymBookRawLog & {
  localDate: string;
  loggedAtMs: number;
  loggedAtLocal: string;
  exportOrder: number;
};

type SessionCluster = {
  sessionIndex: number;
  rows: ParsedLog[];
};

type CliFlags = {
  input?: string;
  output?: string;
  report?: string;
  localDb?: string;
  catalogJson?: string;
  decisions?: string;
  importingProfileLabel?: string;
  timezone?: string;
  dryRun: boolean;
  allowUnresolved: boolean;
  gymAssignments: Partial<GymBucketChoices>;
  help: boolean;
};

const DEFAULT_CLUSTER_GAP_MINUTES = 90;
const DEFAULT_SHORT_SESSION_THRESHOLD_MINUTES = 30;
const DEFAULT_SHORT_SESSION_DURATION_MINUTES = 60;
const DEFAULT_LONG_SESSION_WARNING_MINUTES = 90;
const SOURCE_APP = 'GymBook';

const warning = (code: string, message: string, severity: BogaImportWarning['severity'] = 'warning') => ({
  code,
  severity,
  message,
});

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const normalizeText = (value: string) =>
  decodeXmlEntities(value)
    .replace(/\uFEFF/g, '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .trim();

const extractTag = (xml: string, tag: string): string => {
  const selfClosingPattern = new RegExp(`<${tag}\\s*/>`, 'i');
  if (selfClosingPattern.test(xml)) {
    return '';
  }
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return normalizeText(match?.[1] ?? '');
};

export const readGymBookXmlBuffer = (buffer: Buffer): string => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer).replace(/^\uFEFF/, '');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer).replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
};

export const parseGymBookXml = (xml: string): GymBookRawLog[] => {
  const logs = xml.match(/<log>[\s\S]*?<\/log>/gi) ?? [];
  return logs.map((logXml, index) => ({
    rowIndex: index + 1,
    date: extractTag(logXml, 'date'),
    workout: extractTag(logXml, 'workout'),
    time: extractTag(logXml, 'time'),
    exercise: extractTag(logXml, 'exercise'),
    targetRegion: extractTag(logXml, 'targetRegion'),
    targetMusclesPrimary: extractTag(logXml, 'targetMusclesPrimary'),
    targetMusclesSecondary: extractTag(logXml, 'targetMusclesSecondary'),
    type: extractTag(logXml, 'type'),
    reps: extractTag(logXml, 'reps'),
    weight: extractTag(logXml, 'weight'),
    notes: extractTag(logXml, 'notes'),
    skipped: extractTag(logXml, 'skipped'),
  }));
};

const parseDateTime = (row: GymBookRawLog): ParsedLog => {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(row.time);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid GymBook date/time at source row ${row.rowIndex}: ${row.date} ${row.time}`);
  }
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid GymBook date/time at source row ${row.rowIndex}: ${row.date} ${row.time}`);
  }
  const localDate = `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return {
    ...row,
    exportOrder: row.rowIndex,
    localDate,
    loggedAtMs: date.getTime(),
    loggedAtLocal: `${localDate}T${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}:00`,
  };
};

const isSkipped = (row: GymBookRawLog) => row.skipped.toLowerCase() === 'yes';

const normalizeExerciseName = (name: string) => name.trim().toLowerCase();

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const normalizeWeightValue = (weight: string): { value: string; warnings: BogaImportWarning[] } => {
  const normalized = weight.replace(/[\u00A0\u202F]/g, ' ').trim();
  if (normalized === '') {
    return { value: '', warnings: [] };
  }
  const match = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(normalized);
  if (!match) {
    return {
      value: normalized,
      warnings: [warning('weight_unparsed', `Could not parse weight "${weight}"; preserved original value.`)],
    };
  }
  const unit = match[2].toLowerCase();
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return {
      value: normalized,
      warnings: [warning('weight_unparsed', `Could not parse weight "${weight}"; preserved original value.`)],
    };
  }
  const value = Number.isInteger(numeric) ? numeric.toString() : numeric.toString().replace(/0+$/, '').replace(/\.$/, '');
  if (unit && unit !== 'kg') {
    return {
      value,
      warnings: [warning('weight_non_kg_unit', `Weight unit "${unit}" was not kg; numeric value was preserved.`)],
    };
  }
  return { value, warnings: [] };
};

const resolveExerciseDecisions = (
  rows: ParsedLog[],
  catalog: BogaImportCatalog,
  decisions: Record<string, GymBookExerciseDecisionInput> | undefined
) => {
  const exerciseRows = new Map<string, { name: string; rowIndexes: number[] }>();
  for (const row of rows) {
    const key = normalizeExerciseName(row.exercise);
    const existing = exerciseRows.get(key);
    if (existing) {
      existing.rowIndexes.push(row.rowIndex);
    } else {
      exerciseRows.set(key, { name: row.exercise, rowIndexes: [row.rowIndex] });
    }
  }

  const catalogByName = new Map(catalog.exercises.map((exercise) => [normalizeExerciseName(exercise.name), exercise]));
  const catalogById = new Map(catalog.exercises.map((exercise) => [exercise.id, exercise]));
  const resolved = new Map<string, BogaImportExerciseDecision>();
  const unresolved: { sourceExerciseName: string; rowCount: number; sampleRows: number[] }[] = [];

  for (const entry of exerciseRows.values()) {
    const exact = catalogByName.get(normalizeExerciseName(entry.name));
    if (exact) {
      resolved.set(entry.name, {
        sourceExerciseName: entry.name,
        decision: 'map_existing',
        exerciseDefinitionId: exact.id,
        exerciseName: exact.name,
      });
      continue;
    }

    const decision = decisions?.[entry.name];
    if (!decision) {
      unresolved.push({
        sourceExerciseName: entry.name,
        rowCount: entry.rowIndexes.length,
        sampleRows: entry.rowIndexes.slice(0, 5),
      });
      continue;
    }

    if (decision.decision === 'map_existing') {
      const target = catalogById.get(decision.exerciseDefinitionId);
      if (!target) {
        throw new Error(
          `Exercise mapping for "${entry.name}" points to missing exercise_definition id "${decision.exerciseDefinitionId}"`
        );
      }
      resolved.set(entry.name, {
        sourceExerciseName: entry.name,
        decision: 'map_existing',
        exerciseDefinitionId: target.id,
        exerciseName: target.name,
      });
      continue;
    }

    const muscleMappings = decision.muscleMappings ?? [];
    resolved.set(entry.name, {
      sourceExerciseName: entry.name,
      decision: 'create_new',
      importExerciseKey: decision.importExerciseKey ?? `gymbook-create-${slug(entry.name)}`,
      exerciseName: decision.exerciseName ?? entry.name,
      muscleMappings,
      warnings:
        muscleMappings.length === 0
          ? [
              warning(
                'created_exercise_missing_muscle_mappings',
                `Created exercise "${decision.exerciseName ?? entry.name}" has no muscle mappings yet.`
              ),
            ]
          : [],
    });
  }

  return { resolved, unresolved };
};

const targetForDecision = (decision: BogaImportExerciseDecision): BogaImportExerciseTarget =>
  decision.decision === 'map_existing'
    ? {
        kind: 'existing',
        exerciseDefinitionId: decision.exerciseDefinitionId,
        exerciseName: decision.exerciseName,
      }
    : {
        kind: 'create',
        importExerciseKey: decision.importExerciseKey,
        exerciseName: decision.exerciseName,
      };

const clusterRows = (rows: ParsedLog[], gapMinutes: number): SessionCluster[] => {
  const sorted = [...rows].sort((a, b) => a.loggedAtMs - b.loggedAtMs || a.exportOrder - b.exportOrder);
  const clusters: SessionCluster[] = [];
  let current: SessionCluster | null = null;
  const gapMs = gapMinutes * 60 * 1000;

  for (const row of sorted) {
    const previous = current?.rows[current.rows.length - 1];
    const needsNewCluster =
      !current || !previous || row.localDate !== previous.localDate || row.loggedAtMs - previous.loggedAtMs > gapMs;

    if (needsNewCluster) {
      current = { sessionIndex: clusters.length + 1, rows: [] };
      clusters.push(current);
    }
    const targetCluster = current;
    if (!targetCluster) {
      throw new Error('Internal error: missing GymBook session cluster');
    }
    targetCluster.rows.push(row);
  }

  return clusters;
};

const classifyGymBucket = (startedAtMs: number): 'midday' | 'weekday_evening' | 'weekend' | 'none' => {
  const date = new Date(startedAtMs);
  const day = date.getDay();
  const hour = date.getHours();
  if (day === 0 || day === 6) {
    return 'weekend';
  }
  if (hour >= 11 && hour < 15) {
    return 'midday';
  }
  if (hour >= 17) {
    return 'weekday_evening';
  }
  return 'none';
};

const validateGymAssignments = (catalog: BogaImportCatalog, assignments: GymBucketChoices) => {
  const gymIds = new Set(catalog.gyms.map((gym) => gym.id));
  const entries: [keyof GymBucketChoices, string | null][] = [
    ['midday', assignments.midday],
    ['weekdayEvening', assignments.weekdayEvening],
    ['weekend', assignments.weekend],
  ];
  for (const [bucket, gymId] of entries) {
    if (gymId !== null && !gymIds.has(gymId)) {
      throw new Error(`Gym assignment "${bucket}" points to missing gym id "${gymId}"`);
    }
  }
};

const buildSessionExercises = (
  rows: ParsedLog[],
  decisions: Map<string, BogaImportExerciseDecision>
) => {
  const exercises: {
    orderIndex: number;
    sourceExerciseName: string;
    targetExercise: BogaImportExerciseTarget;
    sets: BogaImportSet[];
  }[] = [];

  for (const row of rows) {
    const decision = decisions.get(row.exercise);
    if (!decision) {
      continue;
    }
    const latest = exercises[exercises.length - 1];
    const targetExercise = targetForDecision(decision);
    const block =
      latest?.sourceExerciseName === row.exercise
        ? latest
        : {
            orderIndex: exercises.length,
            sourceExerciseName: row.exercise,
            targetExercise,
            sets: [],
          };
    if (block !== latest) {
      exercises.push(block);
    }

    const weight = normalizeWeightValue(row.weight);
    const setWarnings = [...weight.warnings];
    if (row.reps.trim() === '') {
      setWarnings.push(warning('reps_missing', `Missing reps at source row ${row.rowIndex}.`));
    }
    block.sets.push({
      orderIndex: block.sets.length,
      repsValue: row.reps.trim(),
      weightValue: weight.value,
      setType: null,
      source: {
        rowIndex: row.rowIndex,
        workoutName: row.workout,
        exerciseName: row.exercise,
        loggedAtLocal: row.loggedAtLocal,
        type: row.type,
        targetRegion: row.targetRegion,
        targetMusclesPrimary: row.targetMusclesPrimary,
        targetMusclesSecondary: row.targetMusclesSecondary,
        ...(row.notes ? { note: row.notes } : {}),
      },
      warnings: setWarnings,
    });
  }

  return exercises;
};

export const digestGymBookExport = (xml: string, options: DigestGymBookOptions): BogaSessionImportPackage => {
  const generatedAt = options.generatedAt ?? new Date();
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local';
  const clusterGapMinutes = options.sessionClusterGapMinutes ?? DEFAULT_CLUSTER_GAP_MINUTES;
  const shortThresholdMinutes = options.shortSessionThresholdMinutes ?? DEFAULT_SHORT_SESSION_THRESHOLD_MINUTES;
  const shortDefaultMinutes = options.shortSessionDefaultDurationMinutes ?? DEFAULT_SHORT_SESSION_DURATION_MINUTES;
  const longWarningMinutes = options.longSessionWarningThresholdMinutes ?? DEFAULT_LONG_SESSION_WARNING_MINUTES;

  if (options.importingProfileLabel.trim() === '') {
    throw new Error('An importing profile label is required before exercise and gym mapping.');
  }

  validateGymAssignments(options.catalog, options.gymAssignments);

  const rawRows = parseGymBookXml(xml);
  const skippedRows = rawRows.filter(isSkipped);
  const importedRows = rawRows.filter((row) => !isSkipped(row)).map(parseDateTime);
  const noteRows = importedRows
    .filter((row) => row.notes.trim() !== '')
    .map((row) => ({
      rowIndex: row.rowIndex,
      sourceExerciseName: row.exercise,
      note: row.notes,
    }));
  const exerciseResolution = resolveExerciseDecisions(importedRows, options.catalog, options.exerciseDecisions);

  if (exerciseResolution.unresolved.length > 0 && !options.allowUnresolvedExercises) {
    throw new Error(
      `Unresolved GymBook exercise mappings: ${exerciseResolution.unresolved
        .map((entry) => entry.sourceExerciseName)
        .join(', ')}`
    );
  }

  const sessionClusters = clusterRows(importedRows, clusterGapMinutes);
  const warnings: BogaImportWarning[] = [];
  const gymAssignmentCounts: Record<string, number> = {};

  const sessions = sessionClusters.flatMap((cluster) => {
    const rows = cluster.rows.filter((row) => exerciseResolution.resolved.has(row.exercise));
    if (rows.length === 0) {
      return [];
    }

    const startedAtMs = rows[0].loggedAtMs;
    const lastLoggedAtMs = rows[rows.length - 1].loggedAtMs;
    const rawSpanSec = Math.max(0, Math.round((lastLoggedAtMs - startedAtMs) / 1000));
    const sessionWarnings: BogaImportWarning[] = [];
    let durationSec = rawSpanSec;

    if (rawSpanSec < shortThresholdMinutes * 60) {
      durationSec = shortDefaultMinutes * 60;
      sessionWarnings.push(
        warning(
          'duration_inferred_short_span',
          `Raw GymBook timestamps span ${Math.round(rawSpanSec / 60)} minutes; duration was set to ${shortDefaultMinutes} minutes.`
        )
      );
    }

    if (rawSpanSec > longWarningMinutes * 60) {
      sessionWarnings.push(
        warning(
          'duration_raw_span_over_90_min',
          `Raw GymBook timestamps span ${Math.round(rawSpanSec / 60)} minutes; review this inferred session.`
        )
      );
    }

    const gymBucket = classifyGymBucket(startedAtMs);
    const gymId =
      gymBucket === 'midday'
        ? options.gymAssignments.midday
        : gymBucket === 'weekday_evening'
          ? options.gymAssignments.weekdayEvening
          : gymBucket === 'weekend'
            ? options.gymAssignments.weekend
            : null;
    const gymCountKey = gymId ?? `no_gym:${gymBucket}`;
    gymAssignmentCounts[gymCountKey] = (gymAssignmentCounts[gymCountKey] ?? 0) + 1;

    const startedAt = new Date(startedAtMs).toISOString();
    const completedAt = new Date(startedAtMs + durationSec * 1000).toISOString();
    const sourceWorkoutNames = [...new Set(rows.map((row) => row.workout).filter(Boolean))];
    const exercises = buildSessionExercises(rows, exerciseResolution.resolved);

    warnings.push(...sessionWarnings);

    return [
      {
        importSessionKey: `gymbook-${rows[0].localDate}-${rows[0].time.replace(':', '')}-${cluster.sessionIndex}`,
        localDate: rows[0].localDate,
        startedAt,
        completedAt,
        durationSec,
        rawSpanSec,
        gymId,
        gymBucket,
        sourceWorkoutNames,
        exercises,
        warnings: sessionWarnings,
      },
    ];
  });

  for (const note of noteRows) {
    warnings.push(
      warning(
        'source_note_preserved',
        `GymBook note at row ${note.rowIndex} was preserved in import metadata because BOGA sets have no notes column.`,
        'info'
      )
    );
  }

  const exerciseDecisions = [...exerciseResolution.resolved.values()].sort((a, b) =>
    a.sourceExerciseName.localeCompare(b.sourceExerciseName)
  );
  const packageValue: BogaSessionImportPackage = {
    schema: BOGA_SESSION_IMPORT_SCHEMA,
    generatedAt: generatedAt.toISOString(),
    target: {
      importingProfileLabel: options.importingProfileLabel,
      ...(options.localDatabasePath ? { localDatabasePath: options.localDatabasePath } : {}),
      catalogSnapshot: {
        exercises: [...options.catalog.exercises].sort((a, b) => a.name.localeCompare(b.name)),
        gyms: [...options.catalog.gyms].sort((a, b) => a.name.localeCompare(b.name)),
      },
    },
    source: {
      app: SOURCE_APP,
      exportFile: options.sourceFile ?? {},
      timezone,
      rowCount: rawRows.length,
      skippedRowCount: skippedRows.length,
    },
    options: {
      sessionClusterGapMinutes: clusterGapMinutes,
      shortSessionThresholdMinutes: shortThresholdMinutes,
      shortSessionDefaultDurationMinutes: shortDefaultMinutes,
      longSessionWarningThresholdMinutes: longWarningMinutes,
      gymAssignments: options.gymAssignments,
    },
    exerciseDecisions,
    sessions,
    report: {
      counts: {
        sourceRows: rawRows.length,
        skippedRows: skippedRows.length,
        importedRows: importedRows.length,
        inferredSessions: sessions.length,
        notesPreserved: noteRows.length,
        unresolvedExercises: exerciseResolution.unresolved.length,
        durationWarnings: warnings.filter((item) => item.code.startsWith('duration_')).length,
      },
      unresolvedExercises: exerciseResolution.unresolved,
      gymAssignmentCounts,
      notes: noteRows,
      warnings,
    },
  };

  return packageValue;
};

export const loadCatalogFromLocalDb = (localDbPath: string): BogaImportCatalog => {
  if (!existsSync(localDbPath)) {
    throw new Error(`Local BOGA SQLite DB not found: ${localDbPath}`);
  }
  const db = new Database(localDbPath, { readonly: true, fileMustExist: true });
  try {
    const exercises = db
      .prepare(
        `select id, name from exercise_definitions where deleted_at is null order by lower(name), id`
      )
      .all() as { id: string; name: string }[];
    const gyms = db
      .prepare(`select id, name from gyms where deleted_at is null order by lower(name), id`)
      .all() as { id: string; name: string }[];
    return { exercises, gyms };
  } finally {
    db.close();
  }
};

const loadCatalogJson = (path: string): BogaImportCatalog => {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { exercises?: unknown }).exercises) ||
    !Array.isArray((parsed as { gyms?: unknown }).gyms)
  ) {
    throw new Error('Catalog JSON must contain exercises and gyms arrays.');
  }
  return parsed as BogaImportCatalog;
};

const loadDecisionJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as {
    exerciseDecisions?: Record<string, GymBookExerciseDecisionInput>;
  };

const parseGymId = (value: string | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return value === 'none' || value === 'null' ? null : value;
};

const parseCliFlags = (argv: string[]): CliFlags => {
  const flags: CliFlags = {
    dryRun: false,
    allowUnresolved: false,
    gymAssignments: {},
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
      case '--output':
        flags.output = next();
        break;
      case '--report':
        flags.report = next();
        break;
      case '--local-db':
        flags.localDb = next();
        break;
      case '--catalog-json':
        flags.catalogJson = next();
        break;
      case '--decisions':
        flags.decisions = next();
        break;
      case '--importing-profile-label':
        flags.importingProfileLabel = next();
        break;
      case '--timezone':
        flags.timezone = next();
        break;
      case '--gym-midday-id':
        flags.gymAssignments.midday = parseGymId(next());
        break;
      case '--gym-weekday-evening-id':
        flags.gymAssignments.weekdayEvening = parseGymId(next());
        break;
      case '--gym-weekend-id':
        flags.gymAssignments.weekend = parseGymId(next());
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--allow-unresolved':
        flags.allowUnresolved = true;
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
  console.log(`GymBook export digester

Usage:
  npm run digest:gymbook -- --input <GymBook.xml> --output <boga-import.json> \\
    --importing-profile-label "<user/profile>" --local-db <path-to-boga-sqlite> \\
    --gym-midday-id <gym-id|none> --gym-weekday-evening-id <gym-id|none> --gym-weekend-id <gym-id|none>

Review/draft mode:
  npm run digest:gymbook -- --input <GymBook.xml> --catalog-json <catalog.json> \\
    --importing-profile-label "<user/profile>" --dry-run --allow-unresolved \\
    --gym-midday-id none --gym-weekday-evening-id none --gym-weekend-id none

Decision JSON shape:
  {
    "exerciseDecisions": {
      "Source Exercise Name": { "decision": "map_existing", "exerciseDefinitionId": "..." },
      "New Source Exercise": { "decision": "create_new", "exerciseName": "New Source Exercise", "muscleMappings": [] }
    }
  }
`);
};

const requireFlag = (value: string | undefined, label: string) => {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
};

const requireGymAssignments = (assignments: Partial<GymBucketChoices>): GymBucketChoices => {
  if (assignments.midday === undefined) {
    throw new Error('--gym-midday-id is required; pass "none" for no gym');
  }
  if (assignments.weekdayEvening === undefined) {
    throw new Error('--gym-weekday-evening-id is required; pass "none" for no gym');
  }
  if (assignments.weekend === undefined) {
    throw new Error('--gym-weekend-id is required; pass "none" for no gym');
  }
  return {
    midday: assignments.midday,
    weekdayEvening: assignments.weekdayEvening,
    weekend: assignments.weekend,
  };
};

export const runGymBookDigesterCli = (argv: string[]) => {
  const flags = parseCliFlags(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const inputPath = requireFlag(flags.input, '--input');
  const importingProfileLabel = requireFlag(flags.importingProfileLabel, '--importing-profile-label');
  if (!flags.localDb && !flags.catalogJson) {
    throw new Error('Provide --local-db or --catalog-json so exercise/gym decisions use the target catalog.');
  }
  if (flags.localDb && flags.catalogJson) {
    throw new Error('Use either --local-db or --catalog-json, not both.');
  }

  const inputBuffer = readFileSync(inputPath);
  const xml = readGymBookXmlBuffer(inputBuffer);
  const catalog = flags.localDb ? loadCatalogFromLocalDb(flags.localDb) : loadCatalogJson(requireFlag(flags.catalogJson, '--catalog-json'));
  const decisions = flags.decisions ? loadDecisionJson(flags.decisions) : {};
  const digest = digestGymBookExport(xml, {
    importingProfileLabel,
    catalog,
    sourceFile: {
      path: basename(inputPath),
      sizeBytes: inputBuffer.length,
      sha256: createHash('sha256').update(inputBuffer).digest('hex'),
    },
    ...(flags.localDb ? { localDatabasePath: flags.localDb } : {}),
    timezone: flags.timezone,
    gymAssignments: requireGymAssignments(flags.gymAssignments),
    exerciseDecisions: decisions.exerciseDecisions,
    allowUnresolvedExercises: flags.allowUnresolved,
  });
  const validation = validateBogaSessionImportPackage(digest, {
    allowUnresolvedExercises: flags.allowUnresolved,
  });
  if (!validation.ok) {
    throw new Error(`Digest output failed contract validation:\n${validation.errors.join('\n')}`);
  }

  const reportJson = JSON.stringify(digest.report, null, 2);
  if (flags.report) {
    writeFileSync(flags.report, `${reportJson}\n`);
  }
  if (flags.output && !flags.dryRun) {
    writeFileSync(flags.output, `${JSON.stringify(digest, null, 2)}\n`);
  }
  console.log(reportJson);
  if (!flags.output && !flags.dryRun) {
    console.error('[gymbook-digester] no --output provided; report printed only.');
  }
  return 0;
};

if (require.main === module) {
  try {
    process.exitCode = runGymBookDigesterCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[gymbook-digester] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
