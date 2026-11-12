// What the Muscles settings pages show of the resolved setup
// ([[muscle.report-groups]]): each muscle Off, On, or in one combined muscle,
// and each combined muscle with its members. Pure: the pages read the setup
// with `readMuscleSetup` and write through `src/data/muscle-report-settings.ts`.
import { isTrackedRow, type CombinedMuscle, type MuscleReportRow } from '@/src/data/combined-muscles';
import type { MuscleSetupChange, MuscleState } from '@/src/data/muscle-report-setup';

/** A muscle's one state: Off, On on its own, or On in the combined muscle `key`. */
export type MuscleChoice = 'off' | 'own' | { key: string };

/**
 * Off is tracking alone: an Off muscle keeps its combined muscle, so turning
 * it On again returns it there. Rows are resolved, so a key always names a
 * definition of the row's family.
 */
export const muscleChoiceOf = (row: MuscleReportRow): MuscleChoice => {
  if (!isTrackedRow(row)) return 'off';
  return row.reportGroup === null ? 'own' : { key: row.reportGroup };
};

export const isSameChoice = (left: MuscleChoice, right: MuscleChoice): boolean =>
  typeof left === 'string' || typeof right === 'string' ? left === right : left.key === right.key;

/** The value a muscle's row shows: `Off`, `On`, or its combined muscle's name. */
export const muscleChoiceLabel = (row: MuscleReportRow, definitions: readonly CombinedMuscle[]): string => {
  const choice = muscleChoiceOf(row);
  if (choice === 'off') return 'Off';
  if (choice === 'own') return 'On';
  return definitions.find((muscle) => muscle.key === choice.key)?.name ?? 'On';
};

/** `23 / 25 on`: tracked entries over every entry. */
export const musclesOnStatus = (rows: readonly MuscleReportRow[]): string =>
  `${rows.filter(isTrackedRow).length} / ${rows.length} on`;

/** The families in display order: the order of their first entry. */
export const muscleFamilies = (rows: readonly MuscleReportRow[]): string[] =>
  [...new Set([...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
    .map((row) => row.familyName))];

const rowsOfFamily = (rows: readonly MuscleReportRow[], family: string): MuscleReportRow[] =>
  rows.filter((row) => row.familyName === family)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));

export type MuscleListRow = { id: string; label: string; value: string };
export type MuscleListSection = { family: string; showHeader: boolean; muscles: MuscleListRow[] };

/** The Muscles list: every entry by family; a family's header shows above two or more. */
export const buildMuscleListSections = ({ rows, definitions }: MuscleSetupChange): MuscleListSection[] =>
  muscleFamilies(rows).map((family) => {
    const muscles = rowsOfFamily(rows, family).map((row) => ({
      id: row.id, label: row.displayName, value: muscleChoiceLabel(row, definitions),
    }));
    return { family, showHeader: muscles.length >= 2, muscles };
  });

/** The members a combined muscle reports: its On entries, in sort order. */
export const combinedMuscleMembers = (rows: readonly MuscleReportRow[], key: string): MuscleReportRow[] =>
  [...rows].filter((row) => row.reportGroup === key && isTrackedRow(row))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));

export type CombinedMuscleRow = CombinedMuscle & { members: string };
export type CombinedMuscleSection = { family: string; muscles: CombinedMuscleRow[] };

const withMembers = (rows: readonly MuscleReportRow[], muscle: CombinedMuscle): CombinedMuscleRow => ({
  ...muscle, members: combinedMuscleMembers(rows, muscle.key).map((row) => row.displayName).join(', '),
});

/** One family's combined muscles, each with its member names. */
export const combinedMusclesOfFamily = ({ rows, definitions }: MuscleSetupChange, family: string): CombinedMuscleRow[] =>
  definitions.filter((muscle) => muscle.family === family).map((muscle) => withMembers(rows, muscle));

/** Every combined muscle by family, families in display order; a family whose entries are gone sorts last. */
export const buildCombinedMuscleSections = (setup: MuscleSetupChange): CombinedMuscleSection[] => {
  const families = [...new Set([...muscleFamilies(setup.rows), ...setup.definitions.map((muscle) => muscle.family)])];
  return families.map((family) => ({ family, muscles: combinedMusclesOfFamily(setup, family) }))
    .filter((section) => section.muscles.length > 0);
};

/**
 * The write a choice on one muscle's page makes. Off keeps the membership;
 * On returns an Off member to its combined muscle, and takes an On member out
 * of one.
 */
export const muscleChoiceWrite = (
  row: MuscleReportRow, next: MuscleChoice,
): { kind: 'tracked'; tracked: boolean } | { kind: 'state'; state: MuscleState } | null => {
  const current = muscleChoiceOf(row);
  if (isSameChoice(current, next)) return null;
  if (next === 'off') return { kind: 'tracked', tracked: false };
  if (next === 'own') {
    return current === 'off' && row.reportGroup !== null
      ? { kind: 'tracked', tracked: true }
      : { kind: 'state', state: { kind: 'own' } };
  }
  return { kind: 'state', state: { kind: 'combined', key: next.key } };
};

export type CombinedMuscleChecklistRow = { id: string; label: string; checked: boolean; note: string | null };

/** Every entry in a combined muscle, Off ones included: what its editor ticks and saves. */
export const combinedMuscleEntryIds = (rows: readonly MuscleReportRow[], key: string): string[] =>
  rows.filter((row) => row.reportGroup === key).map((row) => row.id);

/**
 * The editor's Muscles checklist for `family`: each entry, ticked or not,
 * noted `Off` when it is, and `in <name>` while unticked and in another
 * combined muscle (ticking moves it).
 */
export const buildCombinedMuscleChecklist = (
  { rows, definitions }: MuscleSetupChange, family: string, ticked: ReadonlySet<string>, key: string | null,
): CombinedMuscleChecklistRow[] =>
  rowsOfFamily(rows, family).map((row) => {
    const checked = ticked.has(row.id);
    const other = !checked && row.reportGroup !== null && row.reportGroup !== key
      ? definitions.find((muscle) => muscle.key === row.reportGroup)?.name ?? null : null;
    const note = [isTrackedRow(row) ? null : 'Off', other === null ? null : `in ${other}`].filter(Boolean).join(', ');
    return { id: row.id, label: row.displayName, checked, note: note || null };
  });

/** Save needs a name and at least one ticked muscle. */
export const canSaveCombinedMuscle = (name: string, memberIds: readonly string[]): boolean =>
  name.trim().length > 0 && memberIds.length > 0;
