// Service-only adapter: retained receipts feed the same scorer as group boards.
import type { LoadInputMode } from '../exercise-core/index.ts';
import { isWorkingSet } from '../exercise-calculations/set-semantics.ts';
import { projectCompetitionPerformance } from './competition-score.ts';
import { scoreCoW, type CoWMetric, type CoWParticipant, type CoWSetVersion, type CoWWindow } from './cow-scoring.ts';
// Preserve this scorer and its arithmetic dependencies when adding a new version.
export const COW_SCORER_VERSION = 7;

type Context = { load_input_mode: LoadInputMode; bodyweight_contribution: number;
  bodyweight_calculations_enabled: boolean; scorer_version: number };
type RetainedSource = { memberId: string; setId: string; version: number; receivedAtUs: number;
  contextKey: string; input: { session_started_at_ms: number; completed: boolean; shared: boolean; eligible: boolean;
    weight_value: string; reps_value: string; performance_status: string | null; set_type: string | null;
    source_load_input_mode: LoadInputMode; exercise_definition_id: string;
    body_weight_context: { body_weight_kg: number | null; body_weight_source: string | null;
      body_weight_measurement_id: string | null; body_weight_measured_at: number | null } | null } };
export type CoWEvaluationGraph = { cowId: string; groupId: string; revision: number; sourceToken: string;
  window: CoWWindow; context: Context | null; metrics: CoWMetric[]; participants: CoWParticipant[]; sources: RetainedSource[] };
export class CoWEvaluationError extends Error {
  readonly sqlstate: 'COW02' | 'COW03';
  constructor(sqlstate: 'COW02' | 'COW03', message: string) { super(message); this.sqlstate = sqlstate; }
}

function evaluateSource(row: RetainedSource, graph: CoWEvaluationGraph): CoWSetVersion {
  const input = row.input;
  const context = graph.context!;
  const normalized = graph.window.context!.normalized;
  const body = normalized ? input.body_weight_context : null;
  const values = projectCompetitionPerformance({ weightValue: input.weight_value, repsValue: input.reps_value,
    performanceStatus: input.performance_status, live: input.eligible, source: { loadInputMode: input.source_load_input_mode },
    bodyWeightKg: body?.body_weight_kg ?? null, bodyWeightSource: body?.body_weight_source === 'reading' ? 'reading' : null,
    bodyWeightMeasurementId: body?.body_weight_measurement_id ?? null,
    bodyWeightMeasuredAt: body?.body_weight_measured_at === null || body?.body_weight_measured_at === undefined
      ? null : new Date(body.body_weight_measured_at),
  }, { name: 'CoW', loadInputMode: context.load_input_mode, bodyweightContribution: context.bodyweight_contribution,
    bodyweightCalculationsEnabled: context.bodyweight_calculations_enabled, defaultMetric: 'e1rm' }).values;
  // Only placement matters outside this week; avoid inexact microseconds for extreme client dates.
  const sessionStartedAtUs = input.session_started_at_ms < graph.window.startUs / 1000 ? graph.window.startUs - 1
    : input.session_started_at_ms >= graph.window.endUs / 1000 ? graph.window.endUs : input.session_started_at_ms * 1000;
  return { memberId: row.memberId, setId: row.setId, version: row.version, receivedAtUs: row.receivedAtUs,
    contextKey: row.contextKey, sessionStartedAtUs, completed: input.completed, shared: input.shared,
    eligible: input.eligible && isWorkingSet({ weight: input.weight_value, reps: input.reps_value,
      performanceStatus: input.performance_status === null ? null : 'unperformed', setType: input.set_type }), scores: values };
}

export function evaluateCoWGraph(graph: CoWEvaluationGraph) {
  const unavailable = scoreCoW(graph.window, graph.metrics, graph.participants, []);
  if (unavailable.state === 'unavailable') return unavailable;
  if (!graph.context || graph.context.scorer_version !== COW_SCORER_VERSION) throw new CoWEvaluationError('COW02', 'Unsupported CoW scorer version');
  const result = scoreCoW(graph.window, graph.metrics, graph.participants, graph.sources.map(row => evaluateSource(row, graph)));
  return { ...result, rankings: result.rankings.map(ranking => ({ ...ranking,
    entries: ranking.entries.map(({ sourceSetIds, ...entry }) => {
      const sources = new Map<string, { set_id: string; definition_id: string }>();
      const selected = new Set(sourceSetIds);
      for (const row of graph.sources) {
        if (row.memberId !== entry.memberId || !selected.has(row.setId)) continue;
        // Empty legacy identity means conservative member-wide disclosure.
        const source = { set_id: row.setId, definition_id: row.input.exercise_definition_id ?? '' };
        sources.set(JSON.stringify(source), source);
      }
      return { ...entry, sources: [...sources.values()] };
    }),
  })) };
}
