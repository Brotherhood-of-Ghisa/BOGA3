import { loadRmCurveGraph, type RmCurveRead } from '@/src/data/rm-curve';
import { buildRmCurveModel, rmCurvePriorStart, type RmCurveEvaluation } from './model';

/**
 * Three-state gym scope (`src/utils/gym-scope-route.ts`): `{}` is every gym,
 * `null` is No gym, an ID selects that gym. Default: [[1rm.curve-scope]].
 */
export type RmCurveGym = { gymId?: string | null };

export type RmCurveQuery = Omit<RmCurveEvaluation, 'gymId'> & { exerciseDefinitionId: string; gym: RmCurveGym };

export function createRmCurveRepository(read: typeof loadRmCurveGraph = loadRmCurveGraph) {
  return async ({ gym, ...query }: RmCurveQuery) => {
    const window = { ...query, start: new Date(query.start), end: new Date(query.end) };
    const input: RmCurveRead = { exerciseDefinitionId: query.exerciseDefinitionId, start: rmCurvePriorStart(window), end: window.end };
    const graph = await read(input);
    if (graph === null) return null;
    const gymId = gym.gymId;
    return buildRmCurveModel(graph, gymId === undefined ? window : { ...window, gymId });
  };
}

export const loadRmCurve = createRmCurveRepository();
