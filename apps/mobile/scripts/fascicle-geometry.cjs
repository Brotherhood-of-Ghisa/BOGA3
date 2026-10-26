// Offline geometry only: every segment belongs entirely to one reference triangle.
const EPS = 1e-10;
const at = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const round = n => Math.round(n * 1e10) / 1e10;

function weights(point, triangle) {
  const [a, b, c] = triangle;
  const u = b.map((v, k) => v - a[k]), v = c.map((n, k) => n - a[k]);
  const w = point.map((n, k) => n - a[k]);
  const dot = (x, y) => x.reduce((sum, n, k) => sum + n * y[k], 0);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), wu = dot(w, u), wv = dot(w, v);
  const den = uu * vv - uv * uv;
  if (den <= EPS * EPS) throw new Error('Degenerate reference triangle');
  const s = (wu * vv - wv * uv) / den, t = (wv * uu - wu * uv) / den;
  return [1 - s - t, s, t].map(round);
}

function reconstruct(mesh, face, barycentric) {
  return [0, 1, 2].map(k => barycentric.reduce((sum, w, i) => sum + w * mesh.vertices[mesh.faces[face][i]][k], 0));
}

function planeCut(triangle, values) {
  const hits = [];
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    if ((values[a] < 0) === (values[b] < 0)) continue;
    const point = at(triangle[a], triangle[b], values[a] / (values[a] - values[b]));
    if (!hits.some(p => Math.hypot(...p.map((v, k) => v - point[k])) < EPS)) hits.push(point);
  }
  return hits.length === 2 ? hits : null;
}

// Clip a projected path against a convex triangle using its affine barycentric coordinates.
function projectedInterval(start, end, triangle) {
  const [a, b, c] = triangle;
  const den = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (den <= EPS) return null; // front-facing surface only
  const bary = p => {
    const s = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / den;
    const t = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / den;
    return [1 - s - t, s, t];
  };
  const wa = bary(start), wb = bary(end);
  let lo = 0, hi = 1;
  for (let i = 0; i < 3; i++) {
    const delta = wb[i] - wa[i];
    if (Math.abs(delta) < EPS) { if (wa[i] < -EPS) return null; }
    else if (delta > 0) lo = Math.max(lo, -wa[i] / delta);
    else hi = Math.min(hi, -wa[i] / delta);
  }
  if (hi - lo < EPS) return null;
  return { lo, hi, bary: t => at(wa, wb, t) };
}

function projectedPath(mesh, start, end) {
  const candidates = [];
  mesh.faces.forEach((face, faceIndex) => {
    const triangle = face.slice(0, 3).map(i => mesh.vertices[i]);
    if (Math.max(...triangle.map(p => p[1])) < .30 || Math.min(...triangle.map(p => p[1])) > .62) return;
    const interval = projectedInterval(start, end, triangle);
    if (interval) candidates.push({ ...interval, face: faceIndex });
  });
  const breaks = candidates.flatMap(c => [c.lo, c.hi]);
  // The foremost triangle may change inside an overlap: split at depth intersections too.
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j], lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
    if (hi <= lo) continue;
    const depth = (c, t) => reconstruct(mesh, c.face, c.bary(t))[2];
    const d0 = depth(a, lo) - depth(b, lo), d1 = depth(a, hi) - depth(b, hi);
    if (d0 * d1 < 0) breaks.push(lo + (hi - lo) * d0 / (d0 - d1));
  }
  const cuts = [...new Set(breaks)].sort((a, b) => a - b), result = [];
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2;
    if (hi - lo < EPS) continue;
    const covering = candidates.filter(c => mid >= c.lo && mid <= c.hi);
    covering.sort((a, b) => reconstruct(mesh, b.face, b.bary(mid))[2] - reconstruct(mesh, a.face, a.bary(mid))[2]);
    if (covering.length) {
      const c = covering[0];
      result.push({ face: c.face, a: c.bary(lo).map(round), b: c.bary(hi).map(round) });
    }
  }
  return result;
}

module.exports = { at, weights, reconstruct, planeCut, projectedPath };
