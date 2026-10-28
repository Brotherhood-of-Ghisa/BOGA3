import type { MuscleBodyFace, MuscleBodyMesh, MuscleBodyVertex } from './muscle-body-mesh';

export const MOUSTACHE_FILL = '#393938';

// Curled strips sampled on the existing upper lip, lifted slightly above its facets.
const wing = [
  [0, .770, .764, .1743, .1765], [.006, .775, .762, .1735, .1762],
  [.012, .776, .759, .1697, .1761], [.019, .771, .756, .1678, .1722],
  [.026, .766, .755, .1658, .1667], [.033, .764, .756, .1613, .1613],
  [.039, .766, .759, .1564, .1563], [.043, .770, .764, .1527, .1517],
  [.045, .775, .770, .1521, .1504], [.047, .778, .776, .1509, .1502],
] as const;
const vertices: MuscleBodyVertex[] = [];
const faces: MuscleBodyFace[] = [];
for (const side of [1, -1]) {
  const offset = vertices.length;
  for (const [x, top, bottom, topZ, bottomZ] of wing) {
    vertices.push([side * x, top, topZ], [side * x, bottom, bottomZ]);
  }
  for (let i = 0; i < wing.length - 1; i++) {
    const a = offset + i * 2;
    const pair: readonly [number, number, number][] = [[a, a + 1, a + 2], [a + 1, a + 3, a + 2]];
    for (const [v0, v1, v2] of pair) {
      faces.push(side === 1 ? [v0, v1, v2, 0] : [v0, v2, v1, 0]);
    }
  }
}

export const NOVEMBER_MOUSTACHE_MESH: MuscleBodyMesh = { materials: ['neutral'], vertices, faces };
