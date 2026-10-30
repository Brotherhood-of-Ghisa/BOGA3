// Wire validation for the coach's weekly muscle target writes
// (`PUT /v1/agent/muscle-targets`). No database access and no HTTP, so Jest
// covers these rules beside the app's own target rules
// (`apps/mobile/src/preferences/muscle-targets.ts`), which they mirror
// ([[muscle.weekly-targets]]).
//
// The SQL writer (`agent_set_muscle_targets` in
// supabase/migrations/20261028170000_agent_set_muscle_targets.sql) trusts this
// shape and re-checks only what needs the database: the revision and the merge.
import { buildMuscleReportAssignment, type MuscleReportRow } from '../../../apps/mobile/src/data/muscle-report-presets.ts';
import { deriveMuscleReportPreset } from '../../../apps/mobile/src/data/muscle-report-setup.ts';
import type { MuscleTargetScope } from '../../../apps/mobile/src/preferences/muscle-targets.ts';

const MAX_ID_LENGTH = 200;

type JsonObject = Record<string, unknown>;

export type MuscleTargetsMode = 'single' | 'per_muscle';

/** The fields the coach changes; an omitted one keeps the stored value. */
export type MuscleTargetsChanges = {
  default_weekly_sets?: number;
  mode?: MuscleTargetsMode;
  /** Muscle id to a new target, or null to clear that muscle's override. Sorted by id. */
  overrides?: Record<string, number | null>;
};

export type MuscleTargetsWrite = {
  /** The revision the coach read the targets with. */
  expected_revision: number;
  changes: MuscleTargetsChanges;
};

/** A rejected target write; the Edge Function answers it as 400 VALIDATION_ERROR. */
export class MuscleTargetsError extends Error {}

const KEYS = new Set(['default_weekly_sets', 'mode', 'overrides', 'expected_revision']);

const fail = (message: string): never => {
  throw new MuscleTargetsError(message);
};

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readTarget = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return fail(`${label} must be a positive whole number of weekly working sets.`);
  }
  return value;
};

const readMode = (value: unknown): MuscleTargetsMode => {
  if (value !== 'single' && value !== 'per_muscle') fail('mode must be single or per_muscle.');
  return value as MuscleTargetsMode;
};

const readRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('expected_revision must be the targets revision get_training_status returned.');
  }
  return value;
};

const readOverrides = (value: unknown): Record<string, number | null> => {
  if (!isRecord(value)) return fail('overrides must map muscle ids to a target or null.');
  const entries = Object.entries(value).map(([id, target]): [string, number | null] => {
    if (id.trim().length < 1 || id.length > MAX_ID_LENGTH) fail('overrides names a blank or overlong muscle id.');
    return [id, target === null ? null : readTarget(target, `overrides[${id}]`)];
  });
  // Sorted, so equal input hashes (for idempotency) the same.
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
};

/** The coach's body, strictly parsed; it quotes the revision it read and must change at least one thing. */
export const normalizeMuscleTargetsWrite = (body: JsonObject): MuscleTargetsWrite => {
  for (const key of Object.keys(body)) {
    if (!KEYS.has(key)) fail(`Unsupported field: ${key}`);
  }
  const expected_revision = readRevision(body.expected_revision);
  const changes: MuscleTargetsChanges = {};
  if (body.default_weekly_sets !== undefined) changes.default_weekly_sets = readTarget(body.default_weekly_sets, 'default_weekly_sets');
  if (body.mode !== undefined) changes.mode = readMode(body.mode);
  if (body.overrides !== undefined) {
    const overrides = readOverrides(body.overrides);
    if (Object.keys(overrides).length > 0) changes.overrides = overrides;
  }
  if (Object.keys(changes).length === 0) fail('Name at least one of default_weekly_sets, mode or overrides to change.');
  return { expected_revision, changes };
};

/**
 * The scope the write targets and the muscle ids it may name. The scope is the
 * setup the rows spell out, as the app derives it; the ids are the muscles that
 * setup reports and still counts (a Broad muscle has its anchor's id).
 */
export const muscleTargetScope = (
  rows: readonly MuscleReportRow[],
): { scope: MuscleTargetScope; reportedIds: Set<string> } => {
  const reportedIds = new Set<string>();
  for (const { muscle, tracked } of buildMuscleReportAssignment(rows).values()) {
    if (tracked) reportedIds.add(muscle.id);
  }
  return { scope: deriveMuscleReportPreset(rows), reportedIds };
};

/** Rejects an override naming a muscle outside the user's reported setup, naming the id. */
export const checkOverrideIds = (changes: MuscleTargetsChanges, reportedIds: ReadonlySet<string>): void => {
  for (const id of Object.keys(changes.overrides ?? {})) {
    if (!reportedIds.has(id)) {
      fail(`overrides names ${id}, which is not a muscle your setup reports. Use the ids get_training_status lists.`);
    }
  }
};
