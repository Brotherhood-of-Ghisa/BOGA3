import { loadRmCurveGraph, type RmCurveRead } from '@/src/data/rm-curve';
import { buildRmCurveModel, rmCurvePriorStart, type RmCurveEvaluation } from './model';

export type RmCurveQuery = RmCurveEvaluation & { exerciseDefinitionId: string };

export function createRmCurveRepository(read: typeof loadRmCurveGraph = loadRmCurveGraph) {
  return async (query: RmCurveQuery) => {
    const scope = { ...query, start: new Date(query.start), end: new Date(query.end) };
    const input: RmCurveRead = { exerciseDefinitionId: query.exerciseDefinitionId, start: rmCurvePriorStart(scope), end: scope.end };
    const graph = await read(input);
    return graph === null ? null : buildRmCurveModel(graph, scope);
  };
}

export const loadRmCurve = createRmCurveRepository();
