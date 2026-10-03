/**
 * The one display format of each training figure
 * (`training-metrics-contract.md` §4, `design-language.md` §6). Figures carry
 * no unit and no thousands separators; a sentence adds ` kg` itself.
 */

/** Weight as entered, one decimal on whole kg so a column reads alike: `60.0`, `82.5`, `2.25`. */
export const formatWeight = (kg: number): string =>
  Number.isInteger(kg) ? kg.toFixed(1) : String(kg);

/** 1RM to one decimal everywhere: `104.7`. */
export const formatOneRepMax = (kg: number): string => kg.toFixed(1);

/** Volume in whole kg·reps: `2560`. */
export const formatVolume = (kgReps: number): string => String(Math.round(kgReps));
