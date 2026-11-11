// The pure half of the muscle setup ([[muscle.report-groups]]): the changes a
// user makes to combined muscles and the settings sections, free of the local
// database so the server imports it directly. Every change takes the resolved
// setup and returns the next one; the data layer writes the difference.
import {
  BROAD_COMBINED_MUSCLES,
  broadTemplateKeyOf,
  buildMuscleReportAssignment,
  isCombinedMuscleKey,
  isCombinedMuscleName,
  isTrackedRow,
  type CombinedMuscle,
  type CombinedMuscleSetup,
  type MuscleReportRow,
} from './combined-muscles.ts';

/** What the interim Breakdown switch reads: no combined muscles, or exactly the Broad template. */
export type MuscleReportPreset = 'detailed' | 'broad';

/** One muscle the settings screen lists: the entries it covers and whether any still counts. */
export type SettingsMuscle = { id: string; label: string; family: string; entryIds: string[]; tracked: boolean };

/** Muscles of one family; the header shows only above two or more. */
export type SettingsMuscleSection = { family: string; showHeader: boolean; muscles: SettingsMuscle[] };

/** One muscle's state: Off, On on its own, or a member of the combined muscle `key`. */
export type MuscleState = { kind: 'off' } | { kind: 'own' } | { kind: 'combined'; key: string };

/** The setup a change reads and returns: the definitions to store and every row with its columns. */
export type MuscleSetupChange = Pick<CombinedMuscleSetup, 'definitions' | 'rows'>;

/** A change the family rule or the definition rules forbid. */
export class CombinedMuscleError extends Error {}

const fail = (message: string): never => {
  throw new CombinedMuscleError(message);
};

const definitionOf = (setup: MuscleSetupChange, key: string): CombinedMuscle =>
  setup.definitions.find((muscle) => muscle.key === key) ?? fail(`No combined muscle ${key}.`);

const withRows = (
  setup: MuscleSetupChange, update: (row: MuscleReportRow) => Partial<MuscleReportRow> | null,
): MuscleReportRow[] => setup.rows.map((row) => {
  const next = update(row);
  return next ? { ...row, ...next } : row;
});

const requireFamily = (rows: readonly MuscleReportRow[], ids: ReadonlySet<string>, family: string): void => {
  for (const row of rows) {
    if (ids.has(row.id) && row.familyName !== family) {
      fail(`${row.displayName} is in ${row.familyName}; only ${family} muscles can join this combined muscle.`);
    }
  }
};

/** Sets each listed entry's state; joining a combined muscle needs the entry to be of its family. */
export const setMuscleState = (
  setup: MuscleSetupChange, entryIds: readonly string[], state: MuscleState,
): MuscleSetupChange => {
  const ids = new Set(entryIds);
  if (state.kind === 'combined') requireFamily(setup.rows, ids, definitionOf(setup, state.key).family);
  const columns = state.kind === 'off'
    ? { tracked: 0, reportGroup: null }
    : { tracked: 1, reportGroup: state.kind === 'combined' ? state.key : null };
  return { definitions: setup.definitions, rows: withRows(setup, (row) => (ids.has(row.id) ? columns : null)) };
};

/** The Enabled switch: tracking only, so a combined muscle switched back on keeps its members. */
export const setMuscleTracked = (
  setup: MuscleSetupChange, entryIds: readonly string[], tracked: boolean,
): MuscleSetupChange => {
  const ids = new Set(entryIds);
  return {
    definitions: setup.definitions,
    rows: withRows(setup, (row) => (ids.has(row.id) ? { tracked: tracked ? 1 : 0 } : null)),
  };
};

export type CombinedMuscleDraft = {
  /** An existing key edits that combined muscle; a new key creates one. */
  key: string;
  name: string;
  /** Required to create; an existing combined muscle keeps its family. */
  family?: string;
  /** Every member after the save; at least one. Members dropped go back to their own muscle. */
  memberIds: readonly string[];
};

/** Creates or edits one combined muscle: its name and exactly its members, all switched on. */
export const saveCombinedMuscle = (setup: MuscleSetupChange, draft: CombinedMuscleDraft): MuscleSetupChange => {
  const name = draft.name.trim();
  if (!isCombinedMuscleName(name)) fail('A combined muscle needs a name of at most 60 characters.');
  const existing = setup.definitions.find((muscle) => muscle.key === draft.key);
  if (!existing && !isCombinedMuscleKey(draft.key)) fail(`${draft.key} is not a combined muscle key.`);
  const family = existing?.family ?? draft.family?.trim() ?? '';
  if (family.length === 0) fail('A new combined muscle needs a family.');
  const ids = new Set(draft.memberIds);
  if (!setup.rows.some((row) => ids.has(row.id))) fail('A combined muscle needs at least one muscle.');
  requireFamily(setup.rows, ids, family);
  const definition = { key: draft.key, name, family };
  const definitions = existing
    ? setup.definitions.map((muscle) => (muscle.key === draft.key ? definition : muscle))
    : [...setup.definitions, definition];
  return {
    definitions,
    rows: withRows(setup, (row) => {
      if (ids.has(row.id)) return { tracked: 1, reportGroup: draft.key };
      return row.reportGroup === draft.key ? { reportGroup: null } : null;
    }),
  };
};

/** Renames one combined muscle; its members stay as they are, Off ones included. */
export const renameCombinedMuscle = (setup: MuscleSetupChange, key: string, name: string): MuscleSetupChange => {
  const trimmed = name.trim();
  if (!isCombinedMuscleName(trimmed)) fail('A combined muscle needs a name of at most 60 characters.');
  definitionOf(setup, key);
  return {
    definitions: setup.definitions.map((muscle) => (muscle.key === key ? { ...muscle, name: trimmed } : muscle)),
    rows: setup.rows,
  };
};

/** Deletes one combined muscle; its members go back to their own muscles, tracking unchanged. */
export const deleteCombinedMuscle = (setup: MuscleSetupChange, key: string): MuscleSetupChange => {
  definitionOf(setup, key);
  return {
    definitions: setup.definitions.filter((muscle) => muscle.key !== key),
    rows: withRows(setup, (row) => (row.reportGroup === key ? { reportGroup: null } : null)),
  };
};

/** Detailed: no combined muscles; every member goes back to its own muscle. */
export const clearCombinedMuscles = (setup: MuscleSetupChange): MuscleSetupChange => ({
  definitions: [],
  rows: withRows(setup, (row) => (row.reportGroup === null ? null : { reportGroup: null })),
});

/**
 * "Start from Broad": replaces every combined muscle with the Broad template's
 * 11. Tracked catalogue entries join their template muscle; Off entries and
 * entries in no template muscle stay out.
 */
export const applyBroadTemplate = (setup: MuscleSetupChange): MuscleSetupChange => ({
  definitions: BROAD_COMBINED_MUSCLES.map((muscle) => ({ ...muscle })),
  rows: withRows(setup, (row) => {
    const reportGroup = isTrackedRow(row) ? broadTemplateKeyOf(row.id) : null;
    return reportGroup === row.reportGroup ? null : { reportGroup };
  }),
});

const sameDefinitions = (left: readonly CombinedMuscle[], right: readonly CombinedMuscle[]): boolean =>
  left.length === right.length && left.every((muscle, index) =>
    muscle.key === right[index].key && muscle.name === right[index].name && muscle.family === right[index].family);

/**
 * The interim Breakdown switch's reading of a resolved setup: Detailed with no
 * members, Broad when it is what "Start from Broad" writes (an Off entry may
 * keep its template key), else `custom`.
 */
export const deriveMuscleReportPreset = (setup: MuscleSetupChange): MuscleReportPreset | 'custom' => {
  if (setup.rows.every((row) => row.reportGroup === null)) return 'detailed';
  const broad = setup.rows.every((row) => {
    const key = broadTemplateKeyOf(row.id);
    return row.reportGroup === key || (row.reportGroup === null && (key === null || !isTrackedRow(row)));
  });
  return broad && sameDefinitions(setup.definitions, BROAD_COMBINED_MUSCLES) ? 'broad' : 'custom';
};

/** The user's muscles in display order, in their family sections. `stored` as `buildMuscleReportAssignment` takes it. */
export const buildSettingsMuscleSections = (
  rows: readonly MuscleReportRow[], stored: readonly CombinedMuscle[] | null,
): SettingsMuscleSection[] => {
  const muscles = new Map<string, SettingsMuscle & { sortOrder: number }>();
  for (const [entryId, { muscle, tracked }] of buildMuscleReportAssignment(rows, stored)) {
    const existing = muscles.get(muscle.id);
    if (existing) {
      existing.entryIds.push(entryId);
      existing.tracked ||= tracked;
    } else {
      muscles.set(muscle.id, {
        id: muscle.id, label: muscle.displayName, family: muscle.familyName,
        sortOrder: muscle.sortOrder, entryIds: [entryId], tracked,
      });
    }
  }
  const sections = new Map<string, SettingsMuscle[]>();
  const ordered = [...muscles.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  for (const { sortOrder: _sortOrder, ...muscle } of ordered) {
    sections.set(muscle.family, [...(sections.get(muscle.family) ?? []), muscle]);
  }
  return [...sections].map(([family, members]) => ({ family, showHeader: members.length >= 2, muscles: members }));
};
