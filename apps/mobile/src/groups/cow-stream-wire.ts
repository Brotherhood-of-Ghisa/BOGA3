import { isCoWDefinitionWire, isCoWResultWire } from './cow-wire.ts';
import type { CoWStreamDefinitionWire, CoWStreamItemWire } from './competition-wire.ts';

const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => v !== null && typeof v === 'object' &&
  !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const FIELDS = ['cow_id','group_id','group_exercise_id','week_start','time_zone','starts_at_us','ends_at_us','metrics','revision','exercise_name'];

function definition(v: unknown): v is CoWStreamDefinitionWire {
  if (!exact(v,FIELDS) || !id(v.exercise_name)) return false;
  const { exercise_name: _name, ...cow } = v;
  return isCoWDefinitionWire({ ...cow,state: 'scheduled' });
}

function previous(v: CoWStreamItemWire): boolean {
  if (v.event !== 'updated') return v.previous === null;
  if (!definition(v.previous)) return false;
  const before=v.previous, after=v.definition;
  return before.cow_id === after.cow_id && before.group_id === after.group_id && before.revision < after.revision &&
    before.week_start === after.week_start && before.time_zone === after.time_zone &&
    before.starts_at_us === after.starts_at_us && before.ends_at_us === after.ends_at_us;
}

function finalResult(v: CoWStreamItemWire): boolean {
  if (v.event !== 'results' && v.event !== 'unavailable') return v.result === null;
  if (!isCoWResultWire(v.result)) return false;
  const result=v.result, cow=v.definition;
  return result.cow.cow_id === cow.cow_id && result.cow.group_id === cow.group_id &&
    result.cow.group_exercise_id === cow.group_exercise_id && result.cow.revision === cow.revision &&
    result.state === (v.event === 'results' ? 'ready' : 'unavailable') &&
    result.cow.state === (v.event === 'results' ? 'final' : 'unavailable') &&
    result.rankings.length === cow.metrics.length && cow.metrics.every(metric => result.rankings.some(r => r.metric === metric)) &&
    result.rankings.every(r => r.entries.length <= 1 && r.entries.every(row => row.rank === 1));
}

/** Closed event snapshots and currently disclosed finals; no private intake survives decoding. */
export function isCoWStreamItemWire(v: unknown): v is CoWStreamItemWire {
  if (!exact(v,['kind','key','sort_at_ms','event','definition','previous','actor','result']) || v.kind !== 'cow' ||
    typeof v.key !== 'string' || !/^\d{20}$/.test(v.key) || !Number.isSafeInteger(v.sort_at_ms) ||
    !['scheduled','updated','cancelled','started','ended','results','unavailable'].includes(String(v.event)) ||
    !definition(v.definition) || !(v.actor === null || exact(v.actor,['user_id','username']) && id(v.actor.user_id) &&
      (v.actor.username === null || typeof v.actor.username === 'string'))) return false;
  const item=v as CoWStreamItemWire;
  return previous(item) && finalResult(item);
}
