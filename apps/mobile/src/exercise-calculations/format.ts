/**
 * The one display format of each training figure
 * (`training-metrics-contract.md` §4, `design-language.md` §6). Figures carry
 * no unit and no thousands separators; labels follow [[copy.no-weight-unit]].
 */

/** Weight as entered, one decimal on whole kg so a column reads alike: `60.0`, `82.5`, `2.25`. */
export const formatWeight = (kg: number): string =>
  Number.isInteger(kg) ? kg.toFixed(1) : String(kg);

/** 1RM to one decimal everywhere: `104.7`. */
export const formatOneRepMax = (kg: number): string => kg.toFixed(1);

/** Volume in whole kg·reps: `2560`. */
export const formatVolume = (kgReps: number): string => String(Math.round(kgReps));

/** Allocated muscle sets: at most one decimal, `1.5`, `0.3`. */
export const formatWorkingSetCount = (count: number): string =>
  Number.isFinite(count) ? String(Number(count.toFixed(1)) + 0) : '—';

/** Allocated muscle sets on Today and Progress: whole sets, `2`. */
export const formatWholeSetCount = (count: number): string =>
  Number.isFinite(count) ? String(Math.round(count) + 0) : '—';
