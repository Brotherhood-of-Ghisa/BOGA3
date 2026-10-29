import type { ModelFibreSegment } from '@/components/stats/muscle-body-fibres';
import { projectMuscleBody } from '@/components/stats/muscle-body-projection';

const { contourChains } = require('../scripts/anatomy/contour-chains.cjs');
const line = (a: number, b: number, nz = 1): ModelFibreSegment => [a, 0, .1, b, 0, .1, 0, 0, nz];
const options = { width: 280, height: 280, angleDeg: 0, scores: new Map() };
const paths = (chains: readonly (readonly ModelFibreSegment[])[]) => projectMuscleBody({ ...options,
  selectedFibres: { segments: [], anatomicalParts: [{ id: 'test', chains }] } }).fibres.anatomicalParts![0].d;

it('orders open and reversed source-edge neighbours without changing any segment', () => {
  expect(contourChains([line(0, .1), line(.2, .1)], [[0, 0, 1, 1, 2], [0, 2, 3, 1, 2]])).toEqual([[0, -2]]);
});

it('traces closed contours and disconnected patches exactly once', () => {
  const segments = [line(0, .1), line(.1, .2), line(.2, 0), line(.4, .5)];
  const chains = contourChains(segments, [[0, 0, 1, 1, 2], [0, 1, 2, 2, 3], [0, 2, 3, 0, 1], [0, 4, 5, 5, 6]]);
  expect(chains).toEqual([[3], [0, 1, 2]]);
  expect(chains.flat().sort()).toEqual([0, 1, 2, 3]);
});

it.each([
  ['different cut level', [[0, 0, 1, 1, 2], [1, 1, 2, 2, 3]]],
  ['different source edge', [[0, 0, 1, 1, 2], [0, 8, 9, 2, 3]]],
])('does not join coincident endpoints on a %s', (_name, ports) => {
  expect(contourChains([line(0, .1), line(.1, .2)], ports)).toEqual([[0], [1]]);
});

it('keeps geometric gaps and ambiguous nonmanifold edges separate', () => {
  expect(contourChains([line(0, .1), line(.100001, .2)], [[0, 0, 1, 1, 2], [0, 1, 2, 2, 3]])).toEqual([[0], [1]]);
  expect(contourChains([line(0, .1), line(.1, .2), line(.1, .3)],
    [[0, 0, 1, 1, 2], [0, 1, 2, 2, 3], [0, 1, 2, 3, 4]])).toEqual([[0], [1], [2]]);
});

it('joins exact original-XYZ export seams, but never near-but-distinct source edges', () => {
  const first = [0, '0,0,0', '0,1,0', '1,0,0', '1,1,0'];
  expect(contourChains([line(0, .1), line(.1, .2)],
    [first, [0, '1,0,0', '1,1,0', '2,0,0', '2,1,0']])).toEqual([[0, 1]]);
  expect(contourChains([line(0, .1), line(.1, .2)],
    [first, [0, '1.000001,0,0', '1,1,0', '2,0,0', '2,1,0']])).toEqual([[0], [1]]);
});

it('uses L continuations for contiguous visible edges, and a new M after a culled edge or gap', () => {
  expect(paths([[line(0, .1), line(.1, .2)]])).toBe('M140 140L167.7 140M140 140L112.3 140');
  const interrupted = paths([[line(0, .1), line(.1, .2, -1), line(.2, .3)], [line(.4, .5)]]);
  expect((interrupted.match(/M/g) ?? []).length).toBe(6);
  expect(interrupted).not.toContain('L167.7 140');
});

it('collapses only redundant rounded interior vertices and keeps isolated point caps', () => {
  expect(paths([[line(.100001, .100002), line(.100002, .2)]])).toBe('M153.9 140L167.7 140M126.1 140L112.3 140');
  expect(paths([[line(.100001, .100002)]])).toBe('M153.9 140L153.9 140M126.1 140L126.1 140');
});
