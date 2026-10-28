// The pure half of the muscle setup: preset tables and the settings sections,
// free of the local database so the server imports it directly.
import { BROAD_MUSCLE_PRESET, buildMuscleReportAssignment, type MuscleReportRow } from './muscle-report-presets.ts';

export type MuscleReportPreset = 'detailed' | 'broad';

/** One muscle the settings screen lists: the entries it covers and whether any still counts. */
export type SettingsMuscle = { id: string; label: string; family: string; entryIds: string[]; tracked: boolean };

/** Muscles of one family; the header shows only above two or more ([[muscle.family-sections]]). */
export type SettingsMuscleSection = { family: string; showHeader: boolean; muscles: SettingsMuscle[] };

/** The columns a write sets on a row; an omitted column keeps what the user chose. */
export type RowSetup = { reportGroup?: string | null; tracked?: number };

const broadGroupOf = (): Map<string, string> =>
  new Map(BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries.map((entry) => [entry, muscle.key] as const)));

/** What choosing `preset` writes onto the entry `id`: only `reportGroup` (Detailed clears it, Broad writes its table), never `tracked`. */
export const presetRowSetup = (preset: MuscleReportPreset, id: string): RowSetup => ({
  reportGroup: preset === 'detailed' ? null : broadGroupOf().get(id) ?? null,
});

/**
 * The preset the rows' `reportGroup` columns spell out, else `custom` (another
 * device or an agent wrote something neither preset produces). Track switches
 * never change it: a preset is how entries merge, not what is switched off.
 */
export const deriveMuscleReportPreset = (rows: readonly MuscleReportRow[]): MuscleReportPreset | 'custom' => {
  if (rows.every((row) => row.reportGroup === null)) return 'detailed';
  const groupOf = broadGroupOf();
  return rows.every((row) => row.reportGroup === (groupOf.get(row.id) ?? null)) ? 'broad' : 'custom';
};

/** The user's muscles in display order, in their family sections. */
export const buildSettingsMuscleSections = (rows: readonly MuscleReportRow[]): SettingsMuscleSection[] => {
  const assignment = buildMuscleReportAssignment(rows);
  const muscles = new Map<string, SettingsMuscle & { sortOrder: number }>();
  for (const row of rows) {
    const assigned = assignment.get(row.id);
    if (!assigned) continue;
    const { muscle, tracked } = assigned;
    const existing = muscles.get(muscle.id);
    if (existing) {
      existing.entryIds.push(row.id);
      existing.tracked ||= tracked;
    } else {
      muscles.set(muscle.id, {
        id: muscle.id, label: muscle.displayName, family: muscle.familyName,
        sortOrder: muscle.sortOrder, entryIds: [row.id], tracked,
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
