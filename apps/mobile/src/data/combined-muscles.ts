// Combined muscles ([[muscle.report-groups]]): the user's own merges of
// anatomy entries. Pure, free of the local database, so the agent API imports
// it by relative path.
//
// A definition ({key, name, family}) lives in the synced settings row
// (`user_settings.combined_muscles`); membership lives on each entry's
// `muscle_groups.report_group`. An entry is Off (`tracked` 0), its own muscle
// (`report_group` null) or a member of one combined muscle.
//
// Accounts set up before combined muscles stored Broad preset keys in
// `report_group` and no definitions. Until a device writes definitions
// (`combined_muscles` null), those keys read as the Broad template's combined
// muscles, so every reader agrees before and after the one-time migration.
import type { MuscleReportAssignment, ReportedMuscle } from './muscle-analytics.ts';
import { BROAD_MUSCLE_PRESET } from './muscle-report-presets.ts';

/** Every combined-muscle key starts with this; no anatomy entry id does, so a reported id never names an entry. */
export const COMBINED_MUSCLE_KEY_PREFIX = 'cm_';
export const MAX_COMBINED_MUSCLE_NAME_LENGTH = 60;
const MAX_FAMILY_LENGTH = 200;
const KEY_PATTERN = /^cm_[a-z0-9_]{1,64}$/;

export type CombinedMuscle = { key: string; name: string; family: string };

/** A user's `muscle_groups` row as the setup reads it: `tracked` is 0/1 locally, a boolean from the agent API. */
export type MuscleReportRow = ReportedMuscle & { reportGroup: string | null; tracked: number | boolean };

export const isTrackedRow = (row: Pick<MuscleReportRow, 'tracked'>): boolean => row.tracked === true || row.tracked === 1;

export const isCombinedMuscleKey = (value: unknown): value is string =>
  typeof value === 'string' && KEY_PATTERN.test(value);

const isBoundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export const isCombinedMuscleName = (value: unknown): value is string =>
  isBoundedText(value, MAX_COMBINED_MUSCLE_NAME_LENGTH);

const isDefinition = (value: unknown): value is CombinedMuscle => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isCombinedMuscleKey(candidate.key) && isCombinedMuscleName(candidate.name)
    && isBoundedText(candidate.family, MAX_FAMILY_LENGTH);
};

/** The stored shape: a list of definitions with distinct keys. The server's check constraint accepts the same. */
export const isCombinedMuscleList = (value: unknown): value is CombinedMuscle[] =>
  Array.isArray(value) && value.every(isDefinition) && new Set(value.map((muscle) => muscle.key)).size === value.length;

/**
 * The stored definitions, from JSON text (the local column, the sync wire) or
 * parsed jsonb (the agent API). Null means none stored yet: the legacy reading
 * applies. A value this build cannot read is treated the same way.
 */
export const parseStoredCombinedMuscles = (raw: unknown): CombinedMuscle[] | null => {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  return isCombinedMuscleList(value)
    ? value.map(({ key, name, family }) => ({ key, name, family }))
    : null;
};

/** The key a Broad template muscle takes; the migration and "Start from Broad" both use it. */
export const broadCombinedMuscleKey = (broadKey: string): string => `${COMBINED_MUSCLE_KEY_PREFIX}${broadKey}`;

/** The Broad template's 11 combined muscles, in preset order. */
export const BROAD_COMBINED_MUSCLES: readonly CombinedMuscle[] = BROAD_MUSCLE_PRESET.muscles.map((muscle) => ({
  key: broadCombinedMuscleKey(muscle.key), name: muscle.label, family: muscle.family,
}));

const broadKeyByEntry = new Map(BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) =>
  muscle.entries.map((entry) => [entry, broadCombinedMuscleKey(muscle.key)] as const)));

/** The Broad combined muscle the template puts entry `id` in, else null. */
export const broadTemplateKeyOf = (id: string): string | null => broadKeyByEntry.get(id) ?? null;

/** A legacy row's combined key: its Broad key when the row is a member of that Broad muscle, else none. */
const legacyKeyOf = (row: MuscleReportRow): string | null => {
  const key = broadTemplateKeyOf(row.id);
  return key !== null && row.reportGroup !== null && key === broadCombinedMuscleKey(row.reportGroup) ? key : null;
};

export type CombinedMuscleSetup = {
  /** The definitions in effect, in stored (or template) order. */
  definitions: CombinedMuscle[];
  /** The rows with `reportGroup` normalised: a combined key in effect, else null. */
  rows: MuscleReportRow[];
  /** True when nothing is stored and the setup was read from legacy Broad keys. */
  fromLegacy: boolean;
};

/**
 * The setup every reader uses. A row reports under a combined muscle only when
 * its key names a definition of the row's own family; any other key (unknown,
 * another family, or a definition whose key collides with an entry id) leaves
 * the row its own muscle.
 */
export const resolveCombinedMuscleSetup = (
  rows: readonly MuscleReportRow[], stored: readonly CombinedMuscle[] | null,
): CombinedMuscleSetup => {
  const legacy = stored == null;
  const used = new Set(legacy ? rows.flatMap((row) => legacyKeyOf(row) ?? []) : []);
  const candidates = stored ?? BROAD_COMBINED_MUSCLES.filter((muscle) => used.has(muscle.key));
  const rowIds = new Set(rows.map((row) => row.id));
  const byKey = new Map<string, CombinedMuscle>();
  for (const muscle of candidates) {
    if (!rowIds.has(muscle.key) && !byKey.has(muscle.key)) byKey.set(muscle.key, { ...muscle });
  }
  const resolved = rows.map((row) => {
    const key = legacy ? legacyKeyOf(row) : row.reportGroup;
    const definition = key === null ? undefined : byKey.get(key);
    const reportGroup = definition && definition.family === row.familyName ? definition.key : null;
    return reportGroup === row.reportGroup ? row : { ...row, reportGroup };
  });
  return { definitions: [...byKey.values()], rows: resolved, fromLegacy: legacy };
};

const bySortOrderThenName = (left: ReportedMuscle, right: ReportedMuscle): number =>
  left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName);

/**
 * Per combined key, the member an editor writes a new mapping to
 * ([[muscle.no-breakdown]]): the first tracked member by sort order, else the
 * first member. The combined muscle sorts where it does.
 */
export const combinedMuscleAnchors = (resolvedRows: readonly MuscleReportRow[]): Map<string, MuscleReportRow> => {
  const anchors = new Map<string, MuscleReportRow>();
  for (const row of [...resolvedRows].sort(bySortOrderThenName)) {
    if (row.reportGroup === null) continue;
    const current = anchors.get(row.reportGroup);
    if (!current || (!isTrackedRow(current) && isTrackedRow(row))) anchors.set(row.reportGroup, row);
  }
  return anchors;
};

/**
 * Reads the user's rows into a `MuscleReportAssignment`, in sort order. A
 * member of a combined muscle reports under its key, the definition's name and
 * family, sorted where its anchor sorts; every other row is its own muscle.
 * `stored` is the settings row's definitions, null when none are stored yet.
 */
export const buildMuscleReportAssignment = (
  rows: readonly MuscleReportRow[], stored: readonly CombinedMuscle[] | null,
): MuscleReportAssignment => {
  const setup = resolveCombinedMuscleSetup(rows, stored);
  const byKey = new Map(setup.definitions.map((muscle) => [muscle.key, muscle]));
  const anchors = combinedMuscleAnchors(setup.rows);
  return new Map([...setup.rows].sort(bySortOrderThenName).map((row) => {
    const definition = row.reportGroup === null ? undefined : byKey.get(row.reportGroup);
    const muscle: ReportedMuscle = definition
      ? {
        id: definition.key, displayName: definition.name, familyName: definition.family,
        sortOrder: anchors.get(definition.key)?.sortOrder ?? row.sortOrder,
      }
      : { id: row.id, displayName: row.displayName, familyName: row.familyName, sortOrder: row.sortOrder };
    return [row.id, { muscle, tracked: isTrackedRow(row) }];
  }));
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const legacyScopeOf = (rows: readonly MuscleReportRow[]): 'detailed' | 'broad' | 'custom' => {
  if (rows.every((row) => row.reportGroup === null)) return 'detailed';
  // A row may hold a bare Broad key (not yet migrated) or its combined key (migrated on another device).
  return rows.every((row) => {
    const key = broadTemplateKeyOf(row.id);
    if (row.reportGroup === null) return key === null;
    return key === row.reportGroup || key === broadCombinedMuscleKey(row.reportGroup);
  }) ? 'broad' : 'custom';
};

/**
 * The weekly target overrides an account stored before combined muscles
 * (`user_settings.muscle_target_overrides`: one map per setup), read as the
 * single map keyed by reported muscle id ([[muscle.weekly-targets]]). Only the
 * setup the legacy rows spell out counts; a Broad muscle's id was its preset
 * anchor's, so it moves to that muscle's combined key when the key is in
 * effect. `rows` are the raw (unresolved) rows.
 */
export const legacyMuscleTargets = (
  legacyOverrides: unknown, rows: readonly MuscleReportRow[], stored: readonly CombinedMuscle[] | null,
): Record<string, number> => {
  let parsed = legacyOverrides;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const scoped = (parsed as Record<string, unknown>)[legacyScopeOf(rows)];
  if (scoped === null || typeof scoped !== 'object' || Array.isArray(scoped)) return {};
  const inEffect = new Set(resolveCombinedMuscleSetup(rows, stored).definitions.map((muscle) => muscle.key));
  const keyByAnchor = new Map(BROAD_MUSCLE_PRESET.muscles.map((muscle) =>
    [muscle.anchor, broadCombinedMuscleKey(muscle.key)] as const));
  const targets: Record<string, number> = {};
  for (const [id, target] of Object.entries(scoped as Record<string, unknown>)) {
    if (id.trim().length === 0 || !isPositiveSafeInteger(target)) continue;
    const key = keyByAnchor.get(id);
    const reportedId = key !== undefined && inEffect.has(key) ? key : id;
    Object.defineProperty(targets, reportedId, { value: target, enumerable: true, configurable: true, writable: true });
  }
  return targets;
};
