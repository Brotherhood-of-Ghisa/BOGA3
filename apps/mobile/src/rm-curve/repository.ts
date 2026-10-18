import { loadRmCurveGraph, type RmCurveRead } from '@/src/data/rm-curve';
import { buildRmCurveModel, rmCurveLatestGym, rmCurvePriorStart, type RmCurveEvaluation } from './model';

/**
 * The curve's gym: [[1rm.curve-scope]]'s default (`'latest'`, the most recently
 * trained gym, resolved once the graph is read), or a chosen three-state scope
 * (`src/utils/gym-scope-route.ts`) — `{}` is every gym.
 */
export type RmCurveGym = 'latest' | { gymId?: string | null };

export type RmCurveQuery = Omit<RmCurveEvaluation, 'gymId'> & { exerciseDefinitionId: string; gym: RmCurveGym };

export function createRmCurveRepository(read: typeof loadRmCurveGraph = loadRmCurveGraph) {
  return async ({ gym, ...query }: RmCurveQuery) => {
    const window = { ...query, start: new Date(query.start), end: new Date(query.end) };
    const input: RmCurveRead = { exerciseDefinitionId: query.exerciseDefinitionId, start: rmCurvePriorStart(window), end: window.end };
    const graph = await read(input);
    if (graph === null) return null;
    const gymId = gym === 'latest' ? rmCurveLatestGym(graph, window) : gym.gymId;
    return buildRmCurveModel(graph, gymId === undefined ? window : { ...window, gymId });
  };
}

export const loadRmCurve = createRmCurveRepository();
