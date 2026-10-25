const { createHash } = require('node:crypto');
const { reconstruct } = require('./fascicle-geometry.cjs');

function check(condition, message) {
  if (!condition) throw new Error(`Invalid fascicle asset: ${message}`);
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function vector(value) { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite); }
function text(value) { return typeof value === 'string' && value.length > 0; }
function refs(value, sources) { return Array.isArray(value) && value.length > 0 && value.every(id => text(id) && Object.hasOwn(sources, id)); }

function validateMesh(mesh) {
  check(record(mesh) && Array.isArray(mesh.vertices) && mesh.vertices.length > 0 && mesh.vertices.every(vector), 'reference vertices');
  check(Array.isArray(mesh.materials) && mesh.materials.every(text) && new Set(mesh.materials).size === mesh.materials.length, 'reference materials');
  check(Array.isArray(mesh.faces) && mesh.faces.length > 0, 'reference faces');
  for (const f of mesh.faces) {
    check(Array.isArray(f) && f.length === 4 && f.every(Number.isInteger), 'reference face shape');
    check(f.slice(0, 3).every(i => i >= 0 && i < mesh.vertices.length) && f[3] >= 0 && f[3] < mesh.materials.length, 'reference face indices');
  }
}

function validateSegment(segment, id, mesh) {
  check(record(segment), `${id} segment`);
  check(Number.isInteger(segment.face) && segment.face >= 0 && segment.face < mesh.faces.length, `${id} face`);
  check(segment.side === -1 || segment.side === 1, `${id} side`);
  check(text(segment.path) && ['surface', 'deep-projection'].includes(segment.layer), `${id} path/layer`);
  for (const anchor of [segment.a, segment.b]) {
    check(vector(anchor) && anchor.every(w => w >= -1e-8 && w <= 1 + 1e-8) && Math.abs(anchor.reduce((a, b) => a + b, 0) - 1) < 1e-8, `${id} barycentric anchor`);
    const point = reconstruct(mesh, segment.face, anchor);
    check(point.every(Number.isFinite) && point[0] * segment.side >= -1e-8, `${id} finite coordinates/midline`);
  }
  const a = reconstruct(mesh, segment.face, segment.a), b = reconstruct(mesh, segment.face, segment.b);
  check(Math.hypot(...a.map((v, k) => v - b[k])) > 1e-10, `${id} zero-length segment`);
  if (id === 'chest') {
    check(segment.attachment === 'projected-landmarks' && ['clavicular', 'sternocostal', 'minor'].includes(segment.part), 'chest projection provenance/part');
    check(['fascicle', 'insertion'].includes(segment.kind), 'chest kind');
    check([a, b].every(p => Math.abs(p[0]) >= .016 - 1e-8 && p[1] >= .30 && p[1] <= .62 && p[2] >= -1e-8), 'chest landmark bounds/midline');
    check(segment.part !== 'minor' || segment.layer === 'deep-projection', 'minor projection');
  } else check(mesh.materials[mesh.faces[segment.face][3]] === id, `${id} material membership`);
  if (id === 'abs_rectus') {
    check([a, b].every(p => Math.abs(p[0]) >= .012 - 1e-8), 'rectus midline');
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    check([.05, .16, .27].every(y => hi <= y - .007 + 1e-8 || lo >= y + .007 - 1e-8), 'rectus tendon interruption');
  }
}

function validateAsset(asset, meshBytes) {
  const mesh = JSON.parse(meshBytes);
  validateMesh(mesh);
  check(record(asset) && asset.schemaVersion === 1, 'schema version');
  check(asset.quality === 'schematic-not-anatomically-validated', 'quality');
  const reference = asset.referenceMesh;
  check(record(reference) && reference.path === 'muscle-body-mesh.json' && reference.hashEncoding === 'exact-file-bytes', 'mesh identity metadata');
  check(reference.sha256 === createHash('sha256').update(meshBytes).digest('hex'), 'mesh hash mismatch');
  check(reference.vertices === mesh.vertices.length && reference.faces === mesh.faces.length, 'mesh counts');
  check(record(asset.geometry) && asset.geometry.encoding === 'triangle-local-segments', 'geometry encoding');
  check(record(asset.provenance) && ['generator', 'origin', 'literatureUse'].every(k => text(asset.provenance[k])), 'provenance');
  check(record(asset.sources) && Object.keys(asset.sources).length > 0, 'sources');
  for (const source of Object.values(asset.sources)) check(record(source) && text(source.label) && text(source.url) && /^https:\/\//.test(source.url), 'source citation');
  const expected = mesh.materials.filter(id => id !== 'neutral').sort();
  check(record(asset.muscles) && JSON.stringify(Object.keys(asset.muscles).sort()) === JSON.stringify(expected), 'exact muscle coverage');
  for (const [id, muscle] of Object.entries(asset.muscles)) {
    check(record(muscle) && muscle.quality === asset.quality, `${id} quality`);
    check(text(muscle.members) && text(muscle.direction) && refs(muscle.sourceIds, asset.sources), `${id} anatomy/sources`);
    check(Array.isArray(muscle.limitations) && muscle.limitations.length > 0 && muscle.limitations.every(text), `${id} limitations`);
    check(muscle.attachment === (id === 'chest' ? 'projected-landmarks' : 'material-mask'), `${id} attachment`);
    check(Array.isArray(muscle.segments) && muscle.segments.length > 0, `${id} geometry coverage`);
    for (const segment of muscle.segments) validateSegment(segment, id, mesh);
    check([-1, 1].every(side => muscle.segments.some(s => s.side === side)), `${id} bilateral coverage`);
  }
  const extensions = asset.muscles.chest.extensions;
  check(Array.isArray(extensions) && extensions.length === 1, 'chest extension');
  const minor = extensions[0];
  check(record(minor) && minor.id === 'pectoralis_minor' && minor.part === 'minor' && minor.catalogEntry === false && minor.measuredVolume === false && minor.representation === 'deep-projection' && refs(minor.sourceIds, asset.sources), 'minor extension metadata');
  return asset;
}
module.exports = { validateAsset, validateSegment };
