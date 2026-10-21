const replacements = [
  ['(?:one|single)[\\s-]+hand', '1H'],
  ['(?:one|single)[\\s-]+arm', '1A'],
  ['(?:one|single)[\\s-]+leg', '1L'],
  ['kettlebells', 'KBs'],
  ['kettlebell', 'KB'],
  ['dumbbells', 'DBs'],
  ['dumbbell', 'DB'],
  ['barbell', 'BRB'],
  ['smith[\\s-]+machine', 'S/M'],
  ['cable[\\s-]+machine', 'C/M'],
  ['cable', 'C/M'],
  ['overhead', 'O/H'],
  ['supported', 'Supp.'],
  ['alternating', 'Alt.'],
  ['extensions?', 'Ext.'],
  ['rotations?', 'Rot.'],
  ['close[\\s-]+grip', 'CG'],
  ['wide[\\s-]+grip', 'WG'],
  ['romanian[\\s-]+deadlifts', 'RDLs'],
  ['romanian[\\s-]+deadlift', 'RDL'],
  ['deadlifts', 'DLs'],
  ['deadlift', 'DL'],
  ['assisted', 'Asst.'],
].map(([words, abbreviation]) => ({
  pattern: new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])(?:${words})(?=$|[^\\p{L}\\p{M}\\p{N}_])`, 'giu'),
  abbreviation,
}));

/**
 * Returns a derived label, never an exercise identity or a saved-name replacement.
 * Matches whole words case-insensitively, with spaces/hyphens inside phrases.
 * Preserves text outside matches, standalone Machine and existing abbreviations;
 * repeated calls return the same label. No length limit or truncation is applied.
 */
export const shortenExerciseName = (name: string): string =>
  replacements.reduce(
    (shortened, { pattern, abbreviation }) =>
      shortened.replace(pattern, (_match, prefix: string) => prefix + abbreviation),
    name
  );
