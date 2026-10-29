#!/usr/bin/env node
// Run from any directory: node apps/mobile/scripts/generate-muscle-body-fascicles.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { at, weights, reconstruct, planeCut, projectedPath } = require('./fascicle-geometry.cjs');
const source = require('./muscle-body-fascicles-source.json');
const { validateAsset } = require('./validate-muscle-body-fascicles.cjs');
const { applyGuides } = require('./anatomy/apply-guides.cjs');
const meshPath = path.join(__dirname, '../components/stats/muscle-body-mesh.json');
const assetPath = path.join(__dirname, '../components/stats/muscle-body-fascicles.json');

// shortcut: prototype fields and landmarks are illustrative; replace after anatomical registration, before claiming validated anatomy.
const fields = {
  serratus_anterior: (x, y, z) => y - .5 * z - .1 * x,
  delts_front: (x, y) => x + .28 * y,
  delts_lateral: (x, y, z) => y - 2.5 * Math.abs(z + .005),
  delts_rear: (x, y) => x + .26 * y,
  rotator_cuff: (x, y) => Math.atan2(y - .465, .245 - x),
  back_lats: (x, y) => Math.atan2(x - .235, .44 - y),
  back_upper: (x, y) => y + .05 * x,
  traps_upper: (x, y) => y + .30 * x,
  traps_lower: (x, y) => y - .8 * x,
  spinal_erectors: (x, y) => x + .10 * y,
  biceps: (x, y) => x + .38 * y,
  brachialis: (x, y) => x + .38 * y,
  triceps: (x, y) => y - 3 * Math.abs(x + .38 * y - .465),
  forearms_grip: (x, y) => x + .35 * y,
  abs_rectus: (x, y) => x - Math.tan((y > .16 ? -2 : 8) * Math.PI / 180) * (y - .16),
  abs_obliques: (x, y) => y - 1.3 * x,
  quads: (x, y) => y - 2.7 * Math.abs(x - .13),
  hamstrings: (x, y) => y - 3.2 * Math.abs(x - .16),
  glutes_max: (x, y) => y + .65 * x,
  hip_abductors: (x, y) => Math.atan2(x - .17, y + .21),
  adductors: (x, y) => Math.atan2(x - .035, -.035 - y),
  hip_flexors: (x, y) => Math.atan2(x - .09, y + .22),
  calves: (x, y) => y - 3.2 * Math.abs(x - .175),
  tibialis_anterior: (x, y) => y - 4 * Math.abs(x + .1 * y - .12)
};

function regionalField(id, center) {
  const [x, y, z] = center;
  if (id === 'forearms_grip' && z > .01 && y < .10) return (x, y) => y;
  if (id === 'forearms_grip' && z > .01 && y > .21) return (x, y) => y + 1.4 * x;
  if (id === 'hamstrings' && x < .125) return (x, y) => x + .06 * y;
  if (id === 'adductors' && x < .05) return (x, y) => x + .025 * y;
  if (id === 'quads' && x < .105 && y < -.28) return (x, y) => y - .9 * (.13 - x);
  return fields[id];
}

function trimRectus(segment) {
  const cuts = [0, 1];
  for (const [axis, levels] of [[0, [-.012, .012]], [1, [.043, .057, .153, .167, .263, .277]]]) {
    for (const level of levels) {
      const t = (level - segment[0][axis]) / (segment[1][axis] - segment[0][axis]);
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).flatMap((hi, i) => {
    const lo = cuts[i], [x, y] = at(...segment, (lo + hi) / 2);
    return Math.abs(x) < .012 || [.05, .16, .27].some(band => Math.abs(y - band) < .007)
      ? [] : [[at(...segment, lo), at(...segment, hi)]];
  });
}

function addFields(mesh, muscles) {
  mesh.faces.forEach((face, faceIndex) => {
    const id = mesh.materials[face[3]];
    if (!fields[id]) return;
    const points = face.slice(0, 3).map(i => mesh.vertices[i]);
    const center = [0, 1, 2].map(k => points.reduce((sum, p) => sum + p[k], 0) / 3);
    const side = center[0] < 0 ? -1 : 1;
    const field = regionalField(id, [Math.abs(center[0]), center[1], center[2]]);
    const samples = mesh.faces.filter(f => f[3] === face[3]).flatMap(f => f.slice(0, 3).map(i => mesh.vertices[i])).map(([x, y, z]) => field(Math.abs(x), y, z));
    const lo = Math.min(...samples), hi = Math.max(...samples);
    const count = ['back_lats', 'hip_abductors', 'rotator_cuff', 'hip_flexors', 'adductors'].includes(id) ? 18 : Math.max(9, Math.min(24, Math.ceil((hi - lo) / .012)));
    const levels = id === 'abs_rectus' ? Array.from({ length: 8 }, (_, i) => .024 + i * .011) : Array.from({ length: count }, (_, i) => lo + (hi - lo) * (i + .5) / count);
    levels.forEach((level, index) => {
      const cut = planeCut(points, points.map(([x, y, z]) => field(side * x, y, z) - level));
      if (!cut) return;
      const pieces = id === 'abs_rectus' ? trimRectus(cut) : [cut];
      for (const [a, b] of pieces) {
        if (side * a[0] < -1e-10 || side * b[0] < -1e-10) continue;
        muscles[id].segments.push({ path: `${id}:${side}:${index}`, face: faceIndex, a: weights(a, points), b: weights(b, points), side,
          layer: source.anatomy[id].deep || (id === 'forearms_grip' && center[2] > .01 && center[1] < .10) ? 'deep-projection' : 'surface' });
      }
    });
    if (id !== 'back_upper') return;
    for (let level = .40, index = 0; level < .59; level += .014, index++) {
      const cut = planeCut(points, points.map(([x, y]) => y + .55 * Math.abs(x) - level));
      if (cut && cut.every(p => side * p[0] >= -1e-10)) muscles[id].segments.push({ path: `rhomboid:${side}:${index}`, face: faceIndex, a: weights(cut[0], points), b: weights(cut[1], points), side, layer: 'deep-projection' });
    }
  });
}

const polygons = {
  clavicular: [[.035, .596], [.14, .578], [.254, .475], [.27, .420]],
  sternocostal: [[.016, .574], [.016, .445], [.035, .365], [.071, .315], [.266, .465], [.252, .508]]
};

function inside(x, y, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function clipChest(mesh, segment, part) {
  const a = reconstruct(mesh, segment.face, segment.a), b = reconstruct(mesh, segment.face, segment.b);
  const start = [Math.abs(a[0]), a[1]], end = [Math.abs(b[0]), b[1]], cuts = [0, 1];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const direction = end.map((v, k) => v - start[k]);
  const zeroDepth = -a[2] / (b[2] - a[2]);
  if (zeroDepth > 0 && zeroDepth < 1) cuts.push(zeroDepth);
  for (const polygon of Object.values(polygons)) polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length], edge = q.map((v, k) => v - p[k]);
    const den = cross(direction, edge);
    if (Math.abs(den) < 1e-10) return;
    const delta = p.map((v, k) => v - start[k]);
    const t = cross(delta, edge) / den, u = cross(delta, direction) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  });
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).flatMap((hi, i) => {
    const lo = cuts[i], point = at(start, end, (lo + hi) / 2);
    if (at(a, b, (lo + hi) / 2)[2] < 0) return [];
    if (part === 'minor' || segment.kind === 'insertion') return [{ ...segment, a: at(segment.a, segment.b, lo), b: at(segment.a, segment.b, hi) }];
    const region = inside(...point, polygons.clavicular) ? 'clavicular' : inside(...point, polygons.sternocostal) ? 'sternocostal' : null;
    return region === part ? [{ ...segment, a: at(segment.a, segment.b, lo), b: at(segment.a, segment.b, hi) }] : [];
  });
}

function addChest(mesh, chest) {
  const origins = [[[.070, .444], [.105, .434]], [[.092, .388], [.127, .378]], [[.114, .332], [.149, .322]]];
  const insertion = [[.199, .568], [.214, .555]];
  let pathIndex = 0;
  for (const side of [-1, 1]) {
    const add = (part, start, end, kind = 'fascicle') => {
      const pathId = `chest:${side}:${pathIndex++}`;
      const pieces = projectedPath(mesh, [side * start[0], start[1]], [side * end[0], end[1]]);
      for (const segment of pieces) {
        for (const clipped of clipChest(mesh, { ...segment, kind }, part)) chest.segments.push({ ...clipped, path: pathId, part, side, layer: part === 'minor' ? 'deep-projection' : 'surface', attachment: 'projected-landmarks' });
      }
    };
    for (let i = 0; i < 9; i++) { const t = i / 8; add('clavicular', [.035 + .105 * t, .596 - .018 * t], [.27 - .016 * t, .420 + .055 * t]); }
    for (let i = 0; i < 14; i++) { const t = i / 13; add('sternocostal', [.016 + .055 * t ** 3, .574 - .259 * t], [.252 + .014 * t, .508 - .043 * t]); }
    add('clavicular', [.27, .420], [.254, .475], 'insertion');
    add('sternocostal', [.252, .508], [.266, .465], 'insertion');
    for (const origin of origins) for (let i = 0; i < 7; i++) add('minor', at(...origin, i / 6), at(...insertion, i / 6));
    add('minor', ...insertion, 'insertion');
  }
}

function generate(meshBytes) {
  const mesh = JSON.parse(meshBytes);
  const muscles = Object.fromEntries(Object.entries(source.anatomy).map(([id, entry]) => [id, {
    members: entry.members, direction: entry.direction, sourceIds: entry.refs,
    quality: 'schematic-not-anatomically-validated', limitations: [entry.note, 'Field slopes, landmark coordinates and compartment boundaries are illustrative, not measured on this body.'],
    attachment: id === 'chest' ? 'projected-landmarks' : 'material-mask', segments: []
  }]));
  muscles.chest.extensions = [{ id: 'pectoralis_minor', part: 'minor', catalogEntry: false, measuredVolume: false, representation: 'deep-projection', sourceIds: ['minor'], limitations: ['Surface projection only; not an internal muscle volume.'] }];
  addFields(mesh, muscles);
  addChest(mesh, muscles.chest);
  const asset = {
    schemaVersion: 2,
    referenceMesh: { path: 'muscle-body-mesh.json', sha256: createHash('sha256').update(meshBytes).digest('hex'), hashEncoding: 'exact-file-bytes', vertices: mesh.vertices.length, faces: mesh.faces.length },
    geometry: { encoding: 'mixed-triangle-and-model-segments', anchor: 'Objects: barycentric anchors in face vertex order. Arrays: [ax,ay,az,bx,by,bz,nx,ny,nz], one source side; mirror x and nx.', coordinates: 'Reference mesh coordinates; no offset baked in.', continuity: 'Triangle guides are independent. Model chains follow verified source-edge adjacency; signed local index -i-1 reverses endpoints without changing the normal. Never bridge a gap or culled edge.', layer: 'Independent source guides reveal through covering anatomy; normals hide their own far-facing surfaces.' },
    quality: 'schematic-not-anatomically-validated',
    provenance: { generator: 'apps/mobile/scripts/generate-muscle-body-fascicles.cjs', origin: 'BoGa procedural surface fields plus registered BodyParts3D source shapes; see anatomy for source checksums, license and adaptations.', literatureUse: 'Literature informs qualitative directions only; no publication figures or measured fascicle directions copied. Licensed BodyParts3D geometry informs full muscle shape.' },
    sources: source.sources, muscles
  };
  applyGuides(asset);
  validateAsset(asset, meshBytes);
  return asset;
}

if (require.main === module) {
  const serialized = JSON.stringify(generate(fs.readFileSync(meshPath))) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(assetPath, 'utf8') !== serialized) throw new Error('Fascicle asset is stale; regenerate it');
    console.log('Fascicle asset matches deterministic generator');
  } else { fs.writeFileSync(assetPath, serialized); console.log(`Wrote ${assetPath} (${Buffer.byteLength(serialized)} bytes)`); }
}
module.exports = { generate, trimRectus };
