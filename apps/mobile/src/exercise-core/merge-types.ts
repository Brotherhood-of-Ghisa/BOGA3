export type MergeValue = string | number | boolean | null;
export type MergeWireEntity = {
  type: string;
  id: string;
  client_updated_at_ms: number;
  fields: Record<string, MergeValue>;
};
export const MERGE_ENTITY_TYPES = ['session_exercises', 'exercise_sets', 'session_exercise_tags'] as const;
export function mergeBlockId(entity: MergeWireEntity): string | null {
  if (!(MERGE_ENTITY_TYPES as readonly string[]).includes(entity.type)) return null;
  return entity.type === 'session_exercises' ? entity.id : String(entity.fields.session_exercise_id);
}
export type MergePreview = {
  sourceId: string; destinationId: string; sourceName: string; destinationName: string;
  setCount: number; factor: 0.5 | 1 | 2; token: string;
};
export type MergeReviewItem = {
  id: string; type: string; entityId: string; blockId: string; sessionId: string; exerciseName: string;
  current: Record<string, MergeValue> | null; saved: Record<string, MergeValue> | null;
  token: string; invalid: boolean; sessionStartedAt?: number;
};
