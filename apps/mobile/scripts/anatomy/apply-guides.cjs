const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const source = require('./source.json');
const { contourChains } = require('./contour-chains.cjs');

function registeredGuides() {
  const bytes = fs.readFileSync(path.join(__dirname, 'registered-guides.json.gz'));
  const json = gunzipSync(bytes);
  if (createHash('sha256').update(json).digest('hex') !== source.registeredGuidesSha256) throw new Error('Registered anatomy guide hash mismatch');
  return JSON.parse(json);
}

function applyGuides(asset) {
  const groups = registeredGuides();
  const topologyBytes = gunzipSync(fs.readFileSync(path.join(__dirname, 'registered-topology.json.gz')));
  if (createHash('sha256').update(topologyBytes).digest('hex') !== source.registeredTopologySha256) throw new Error('Registered anatomy topology hash mismatch');
  const topology = JSON.parse(topologyBytes);
  asset.anatomy = structuredClone(source);
  asset.sources.bodyparts3d = { label: source.sources.attribution, url: source.sources.licenseUrl };
  for (const [id, parts] of Object.entries(groups)) {
    const muscle = asset.muscles[id];
    muscle.segments = source.retainSurface.includes(id) ? muscle.segments.filter(segment => segment.layer === 'surface') : [];
    muscle.attachment = source.retainSurface.includes(id) ? 'mixed' : 'model-space';
    muscle.sourceIds = [...muscle.sourceIds, 'bodyparts3d'];
    const retained = id === 'chest' ? 'Pectoralis major surface guides; ' : id === 'back_upper' ? 'Middle trapezius surface guides; ' : '';
    muscle.members = retained + parts.map(part => source.sources.models[part.id].name).join('; ') + '; mirrored bilaterally.';
    muscle.direction = ['brachialis', 'calves'].includes(id)
      ? 'Illustrative directional plane cuts on registered source shapes; not measured pennation or fascicles.'
      : 'Procedural longitudinal surface meridians following source-shape taper; not measured fascicle directions.';
    muscle.limitations = ['BodyParts3D shapes adapted to the avatar pose; registration is provisional. Fibre directions are schematic, not measured fascicles.'];
    muscle.anatomicalParts = parts.map(part => {
      const start = muscle.segments.length;
      const keep = part.segments.map((s, index) => Math.hypot(s[0] - s[3], s[1] - s[4], s[2] - s[5]) > 1e-10 ? index : -1).filter(index => index >= 0);
      const segments = keep.map(index => part.segments[index]);
      const chains = contourChains(segments, keep.map(index => topology[part.id][index]));
      muscle.segments.push(...segments);
      return { id: part.id, start, count: segments.length, chains };
    });
  }
  asset.muscles.chest.extensions[0].representation = 'independent-model-space';
  asset.muscles.chest.extensions[0].sourceIds = ['bodyparts3d'];
  asset.muscles.chest.extensions[0].limitations = ['Schematic fibres on an independently registered source shape; not a measured BoGa muscle volume.'];
  return asset;
}

module.exports = { applyGuides, registeredGuides };
