import rawMesh from './muscle-body-mesh.json';
import type { MuscleMapId } from './muscle-map-reference';

export type MuscleBodyMaterialId = 'neutral' | MuscleMapId;

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
