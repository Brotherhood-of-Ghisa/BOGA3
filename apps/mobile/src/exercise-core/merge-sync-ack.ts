import type { MergeWireEntity } from './merge-types';

export function validateMergeOutcomes(data: unknown, batch: MergeWireEntity[]): boolean {
  const body = data as { ok?: boolean; outcomes?: { type: string; id: string; outcome: string }[] } | null;
  if (!body?.ok) throw new Error('Sync did not acknowledge the changes.');
  // The compact all-accepted acknowledgement remains valid; selective acks cover every row.
  if (body.outcomes === undefined) return false;
  if (!Array.isArray(body.outcomes) || body.outcomes.length !== batch.length) throw new Error('Incomplete sync acknowledgement.');
  const expected = new Set(batch.map(row => row.type + ':' + row.id));
  for (const result of body.outcomes) {
    if (!expected.delete(result.type + ':' + result.id) || !['accepted', 'preserved'].includes(result.outcome)) {
      throw new Error('Invalid sync acknowledgement.');
    }
  }
  return body.outcomes.some(result => result.outcome === 'preserved');
}
