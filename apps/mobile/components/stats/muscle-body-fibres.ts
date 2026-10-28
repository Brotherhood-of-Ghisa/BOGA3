import rawFascicles from './muscle-body-fascicles.json';

export type MuscleBodyFibreSegment = {
  readonly face: number;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly layer: 'surface' | 'deep-projection';
};

export type MuscleBodyFascicles = Readonly<Record<string, {
  readonly segments: readonly MuscleBodyFibreSegment[];
}>>;

// Exact mesh binding and schematic limitations are checked by the offline asset validator.
export const MUSCLE_BODY_FASCICLES = rawFascicles.muscles as unknown as MuscleBodyFascicles;
