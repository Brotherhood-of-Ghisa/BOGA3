export function latentRirStates(recorded: number): number[] {
  if (!Number.isSafeInteger(recorded) || recorded < 0 || !Number.isSafeInteger(recorded + 1))
    throw new Error('invalid recorded RIR');
  return recorded === 0 ? [0] : [recorded - 1, recorded, recorded + 1];
}

export function conditionalRirProbability(recorded: number, latent: number, correctProbability: number): number {
  const states = latentRirStates(recorded);
  if (!Number.isSafeInteger(latent) || latent < 0 || !Number.isFinite(correctProbability) ||
    correctProbability < 0 || correctProbability > 1) throw new Error('invalid conditional RIR model');
  if (!states.includes(latent)) return 0;
  if (recorded === 0) return 1;
  return latent === recorded ? correctProbability : (1 - correctProbability) / 2;
}

export function latentRirFromRecorded(recorded: number, correctProbability: number, uniformDraw: number): number {
  const states = latentRirStates(recorded);
  conditionalRirProbability(recorded, recorded, correctProbability);
  if (!Number.isFinite(uniformDraw) || uniformDraw < 0 || uniformDraw >= 1) throw new Error('invalid uniform draw');
  if (recorded === 0) return 0;
  const tail = (1 - correctProbability) / 2;
  return uniformDraw < tail ? states[0] : uniformDraw < tail + correctProbability ? states[1] : states[2];
}

function normalAreaFromZero(x: number): number {
  const h = x / 128;
  let sum = 1 + Math.exp(-x * x / 2);
  for (let i = 1; i < 128; i++) sum += (i % 2 ? 4 : 2) * Math.exp(-((i * h) ** 2) / 2);
  return h * sum / (3 * Math.sqrt(2 * Math.PI));
}

function normalLogSurvival(x: number): number {
  if (Number.isNaN(x)) throw new Error('invalid normal coordinate');
  if (x < 0) return Math.log1p(-Math.exp(normalLogSurvival(-x)));
  if (x < 2) return Math.log(0.5 - normalAreaFromZero(x));
  // Gaussian tail continued fraction (NIST DLMF 7.9); retain its log before underflow.
  let fraction = 0;
  for (let k = 64; k >= 1; k--) fraction = k / (x + fraction);
  return -x * x / 2 - Math.log(2 * Math.PI) / 2 - Math.log(x + fraction);
}

export function normalCdf(x: number): number {
  return x <= 0 ? Math.exp(normalLogSurvival(-x)) : -Math.expm1(normalLogSurvival(x));
}

// Multipliers follow latentRirStates(recordedRir): one state at zero, otherwise lower/central/upper.
export type JointRirPoint = { load: number; recordedRir: number; multipliers: number[] };

function loadLogNormalizer(predicted: number, sd: number): number {
  return -Math.log(sd * Math.sqrt(2 * Math.PI)) - (predicted / sd >= 9 ? 0 : Math.log(normalCdf(predicted / sd)));
}

function loadLogDensity(load: number, predicted: number, sd: number): number {
  return loadLogNormalizer(predicted, sd) - (load - predicted) ** 2 / (2 * sd * sd);
}

function logMixture(terms: number[]): number {
  const maximum = Math.max(...terms);
  return maximum === -Infinity ? -Infinity : maximum +
    Math.log(terms.reduce((sum, term) => sum + Math.exp(term - maximum), 0));
}

export function jointLogLikelihood(points: JointRirPoint[], strength: number, correctProbability: number, loadSd: number): number {
  if (!points.length || !Number.isFinite(strength) || strength <= 0 || !Number.isFinite(correctProbability) ||
    correctProbability < 0 || correctProbability > 1 || !Number.isFinite(loadSd) || loadSd <= 0)
    throw new Error('invalid conditional model');
  let likelihood = 0;
  for (const point of points) {
    const states = latentRirStates(point.recordedRir);
    if (!Number.isFinite(point.load) || point.load < 0 || point.multipliers.length !== states.length ||
      point.multipliers.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('invalid conditional point');
    const terms = point.multipliers.map((multiplier, index) => {
      const probability = conditionalRirProbability(point.recordedRir, states[index], correctProbability);
      return Math.log(probability) + loadLogDensity(point.load, strength / multiplier, loadSd);
    });
    likelihood += logMixture(terms);
  }
  return likelihood;
}

// Factor the same conditional load mixture; axes are [correctProbability][strength].
export function jointLikelihoodGrid(points: JointRirPoint[], strengths: number[], probabilities: number[], loadSd: number): number[][] {
  if (!strengths.length || !probabilities.length || strengths.some(s => !Number.isFinite(s) || s <= 0) ||
    probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error('invalid likelihood grid');
  jointLogLikelihood(points, strengths[0], probabilities[0], loadSd);
  const weights = probabilities.map(probability => points.map(point => latentRirStates(point.recordedRir)
    .map(r => Math.log(conditionalRirProbability(point.recordedRir, r, probability)))));
  const multipliers = [...new Set(points.flatMap(p => p.multipliers))];
  const loads = strengths.map(s => {
    const normalizers = new Map(multipliers.map(f => [f, loadLogNormalizer(s / f, loadSd)]));
    return points.map(p => p.multipliers.map(f => normalizers.get(f)! - (p.load - s / f) ** 2 / (2 * loadSd * loadSd)));
  });
  return weights.map(ps => loads.map(ls => ps.reduce((sum, terms, i) =>
    sum + logMixture(terms.map((term, r) => term + ls[i][r])), 0)));
}

// Compile invariant component data once for repeated trajectory likelihood evaluations.
export function conditionalTrajectoryLikelihood(points: JointRirPoint[]) {
  jointLogLikelihood(points, 1, 0.5, 2.5);
  const components = points.map(p => ({ load: p.load, inverse: p.multipliers.map(f => 1 / f), zero: p.recordedRir === 0 }));
  return (strengths: number[], probability: number, sd: number): number => {
    if (strengths.length !== points.length || strengths.some(s => !Number.isFinite(s) || s <= 0) ||
      !Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isFinite(sd) || sd <= 0)
      throw new Error('invalid conditional trajectory');
    const central = Math.log(probability), tail = Math.log((1 - probability) / 2);
    return components.reduce((sum, point, i) => sum + logMixture(point.inverse.map((inverse, j) =>
      (point.zero ? 0 : j === 1 ? central : tail) + loadLogDensity(point.load, strengths[i] * inverse, sd))), 0);
  };
}
