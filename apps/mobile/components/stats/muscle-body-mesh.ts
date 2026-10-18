import rawMesh from './muscle-body-mesh.json';

export type MuscleBodyMaterialId =
  | 'neutral'
  | 'chest'
  | 'delts_front'
  | 'delts_lateral'
  | 'delts_rear'
  | 'back_lats'
  | 'back_upper'
  | 'traps_upper'
  | 'spinal_erectors'
  | 'biceps'
  | 'triceps'
  | 'forearms_grip'
  | 'abs_rectus'
  | 'abs_obliques'
  | 'quads'
  | 'hamstrings'
  | 'glutes_max'
  | 'hip_abductors'
  | 'adductors'
  | 'calves';

export type MuscleBodyVertex = readonly [x: number, y: number, z: number];
export type MuscleBodyFace = readonly [
  v0: number,
  v1: number,
  v2: number,
  materialIndex: number,
];

export type MuscleBodyMesh = {
  readonly materials: readonly MuscleBodyMaterialId[];
  readonly vertices: readonly MuscleBodyVertex[];
  readonly faces: readonly MuscleBodyFace[];
};

export const MUSCLE_BODY_MESH: MuscleBodyMesh = {
  materials: rawMesh.materials as readonly MuscleBodyMaterialId[],
  vertices: rawMesh.vertices as unknown as readonly MuscleBodyVertex[],
  faces: rawMesh.faces as unknown as readonly MuscleBodyFace[],
};
