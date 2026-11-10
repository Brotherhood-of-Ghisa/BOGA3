import { mergeBlockId, type MergeWireEntity } from './merge-types';

const identity = (row: MergeWireEntity) => row.type + ':' + row.id;
const ignored = new Set(['merge_revision', 'client_updated_at_ms', 'created_at', 'updated_at', 'duration_sec']);
export function sameWorkoutRow(left: MergeWireEntity | undefined, right: MergeWireEntity | undefined): boolean {
  if (!left || !right) return left === right;
  return [...new Set([...Object.keys(left.fields), ...Object.keys(right.fields)])]
    .every(key => ignored.has(key) || left.fields[key] === right.fields[key]);
}

function lifecycleChanged(before: MergeWireEntity[], current: MergeWireEntity[]): boolean {
  const a = before.find(row => row.type === 'sessions');
  const b = current.find(row => row.type === 'sessions');
  return ['status', 'deleted_at', 'completed_at'].some(key => a?.fields[key] !== b?.fields[key]);
}

function blockChanged(before: MergeWireEntity[], current: MergeWireEntity[], blockId: string): boolean {
  const a = before.filter(row => mergeBlockId(row) === blockId);
  const b = current.filter(row => mergeBlockId(row) === blockId);
  const byId = new Map(b.map(row => [identity(row), row]));
  return a.length !== b.length || a.some(row => !sameWorkoutRow(row, byId.get(identity(row))));
}

/** Rebase actual editor intent; remote-only rows never become implicit removals. */
export function rebaseWorkoutEdit(before: MergeWireEntity[], edited: MergeWireEntity[], current: MergeWireEntity[]) {
  const baseline = new Map(before.map(row => [identity(row), row]));
  const canonical = new Map(current.map(row => [identity(row), row]));
  const changes = edited.filter(row => !sameWorkoutRow(row, baseline.get(identity(row))));
  const closed = lifecycleChanged(before, current);
  const conflicts = changes.filter(row => {
    const original = baseline.get(identity(row));
    const remote = canonical.get(identity(row));
    if (sameWorkoutRow(row, remote)) return false;
    if (closed) return true;
    const blockId = mergeBlockId(row);
    const originalBlock = before.find(candidate => candidate.type === 'session_exercises' && candidate.id === blockId);
    const remoteBlock = current.find(candidate => candidate.type === 'session_exercises' && candidate.id === blockId);
    if (originalBlock && originalBlock.fields.exercise_definition_id !== remoteBlock?.fields.exercise_definition_id) return true;
    if (row.type === 'session_exercises' && row.fields.deleted_at && blockChanged(before, current, row.id)) return true;
    return !sameWorkoutRow(original, remote);
  });
  if (conflicts.length) return { rows: current, preserved: changes, changed: false };
  const sessionRevision = Number(current.find(row => row.type === 'sessions')?.fields.merge_revision ?? 0);
  for (const row of changes) {
    const remote = canonical.get(identity(row));
    const block = current.find(candidate => candidate.type === 'session_exercises' && candidate.id === mergeBlockId(row));
    const revision = Math.max(sessionRevision, Number(remote?.fields.merge_revision ?? block?.fields.merge_revision ?? 0));
    canonical.set(identity(row), { ...row, fields: { ...row.fields, merge_revision: revision } });
  }
  return { rows: [...canonical.values()], preserved: [], changed: changes.length > 0 };
}
