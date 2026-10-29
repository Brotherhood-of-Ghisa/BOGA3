import rawFascicles from './muscle-body-fascicles.json';

export type TriangleFibreSegment = {
  readonly face: number;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly layer: 'surface' | 'deep-projection';
};

/** One atlas side: endpoints followed by outward normal; mirror x at projection. */
export type ModelFibreSegment = readonly [number, number, number, number, number, number, number, number, number];
export type MuscleBodyFibreSegment = TriangleFibreSegment | ModelFibreSegment;

export const isModelFibre = (segment: MuscleBodyFibreSegment): segment is ModelFibreSegment => Array.isArray(segment);

export type MuscleBodyFascicles = Readonly<Record<string, {
  readonly segments: readonly MuscleBodyFibreSegment[];
  readonly anatomicalParts?: readonly { readonly id: string; readonly start: number; readonly count: number; readonly chains: readonly (readonly number[])[] }[];
}>>;

export type MuscleBodyFibreSelection = {
  readonly segments: readonly TriangleFibreSegment[];
  readonly anatomicalParts: readonly { readonly id: string; readonly chains: readonly (readonly ModelFibreSegment[])[] }[];
};

// Exact mesh binding and schematic limitations are checked by the offline asset validator.
export const MUSCLE_BODY_FASCICLES = rawFascicles.muscles as unknown as MuscleBodyFascicles;
