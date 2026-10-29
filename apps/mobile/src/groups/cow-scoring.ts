// Service-only aggregation of authorized group projections; no raw workout or reading inputs.
import { competitionUnit, type CompetitionMetric, type CompetitionValue } from './competition-contract.ts';

export type CoWMetric = CompetitionMetric | 'improvement';
export type CoWContext = { key: string; normalized: boolean };
export type CoWWindow = { startUs: number; endUs: number; readBeforeUs: number;
  context: CoWContext | null; contextChangedAtUs: number | null };
export type CoWParticipant = { memberId: string; endedAtUs: number | null };
/** One coherent intake version, including removals. Times are exact epoch microseconds.
 * A retry retains its version/receipt; only scoring/eligibility dependencies create a version.
 * Missing scores represent absent projections; eligibility is resolved by the server, never here. */
export type CoWSetVersion = {
  memberId: string; setId: string; version: number; receivedAtUs: number; contextKey: string;
  sessionStartedAtUs: number; completed: boolean; shared: boolean; eligible: boolean;
  scores: readonly CompetitionValue[];
};
export type CoWEntry = { memberId: string; value: number; receivedAtUs: number; rank: number };
export type CoWRanking = { metric: CoWMetric; unit: CompetitionValue['unit'] | 'percent';
  entries: CoWEntry[]; unavailableMemberIds: string[] };
export type CoWResult = { state: 'ready' | 'unavailable'; rankings: CoWRanking[] };

function assertTime(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid CoW microsecond timestamp');
}

function validateWindow(window: CoWWindow, metrics: readonly CoWMetric[]): void {
  [window.startUs, window.endUs, window.readBeforeUs].forEach(assertTime);
  if (window.contextChangedAtUs !== null) assertTime(window.contextChangedAtUs);
  if (window.startUs >= window.endUs || window.readBeforeUs < window.startUs ||
    !metrics.length || new Set(metrics).size !== metrics.length ||
    metrics.some(metric => !['e1rm', 'volume', 'improvement'].includes(metric)) ||
    (window.context !== null && !window.context.key)) throw new Error('Invalid CoW window or metrics');
}

function validateVersion(row: CoWSetVersion, context: CoWContext): void {
  [row.receivedAtUs, row.sessionStartedAtUs].forEach(assertTime);
  if (!row.memberId || !row.setId || !Number.isSafeInteger(row.version) || row.version < 1 ||
    row.contextKey !== context.key || typeof row.completed !== 'boolean' ||
    typeof row.shared !== 'boolean' || typeof row.eligible !== 'boolean' ||
    new Set(row.scores.map(score => score.metric)).size !== row.scores.length ||
    row.scores.some(score => !['volume', 'e1rm'].includes(score.metric) ||
      score.unit !== competitionUnit(score.metric, context.normalized))) {
    throw new Error('Invalid CoW source context');
  }
}

function counting(row: CoWSetVersion | undefined, window: CoWWindow): row is CoWSetVersion {
  return !!row && row.completed && row.shared && row.eligible && row.receivedAtUs >= window.startUs &&
    row.sessionStartedAtUs >= window.startUs && row.sessionStartedAtUs < window.endUs;
}

function valueOf(row: CoWSetVersion, metric: CompetitionMetric): number | undefined {
  return row.scores.find(score => score.metric === metric)?.value;
}

function hasVolume(row: CoWSetVersion | undefined, window: CoWWindow): boolean {
  if (!counting(row, window)) return false;
  const value = valueOf(row, 'volume');
  return value !== undefined && (value > 0 || !Number.isFinite(value));
}

/** Resolve latest state before filtering eligibility: a tombstone replaces its older score. */
function memberStates(rows: readonly CoWSetVersion[], window: CoWWindow, cutoff: number) {
  const baseline = new Map<string, CoWSetVersion>();
  const latest = new Map<string, CoWSetVersion>();
  const seen = new Map<string, string>();
  let volumeReceipt = 0;
  for (const row of rows) {
    if (row.receivedAtUs >= cutoff) continue;
    const key = JSON.stringify([row.setId, row.version]);
    const contents = JSON.stringify([row.receivedAtUs, row.contextKey, row.sessionStartedAtUs,
      row.completed, row.shared, row.eligible, row.scores.map(score =>
        [score.metric, score.unit, String(score.value)]).sort((a, b) => compareIds(a[0], b[0]))]);
    if (seen.has(key)) {
      if (seen.get(key) !== contents) throw new Error('Conflicting CoW intake version');
      continue;
    }
    seen.set(key, contents);
    const previous = latest.get(row.setId);
    if (row.receivedAtUs >= window.startUs && (hasVolume(previous, window) || hasVolume(row, window))) {
      volumeReceipt = row.receivedAtUs;
    }
    latest.set(row.setId, row);
    if (row.receivedAtUs < window.startUs) baseline.set(row.setId, row);
  }
  return { baseline: [...baseline.values()].filter(row => row.sessionStartedAtUs < window.startUs &&
    row.completed && row.shared && row.eligible), weekly: [...latest.values()].filter(row => counting(row, window)), volumeReceipt };
}

function summarize(rows: readonly CoWSetVersion[], metric: CompetitionMetric) {
  let value = 0;
  let receivedAtUs = Infinity;
  let unavailable = false;
  for (const row of rows) {
    const score = valueOf(row, metric);
    if (score === undefined) continue;
    if (!Number.isFinite(score)) { unavailable = true; continue; }
    if (score <= 0) continue;
    if (metric === 'volume') value += score;
    else if (score > value) { value = score; receivedAtUs = row.receivedAtUs; }
    else if (score === value) receivedAtUs = Math.min(receivedAtUs, row.receivedAtUs);
  }
  return { value, receivedAtUs, unavailable: unavailable || !Number.isFinite(value) };
}

function memberValue(states: ReturnType<typeof memberStates>, metric: CoWMetric) {
  const weekly = summarize(states.weekly, metric === 'volume' ? 'volume' : 'e1rm');
  if (metric === 'volume') return { ...weekly, receivedAtUs: states.volumeReceipt };
  if (metric === 'e1rm') return weekly;
  const baseline = summarize(states.baseline, 'e1rm');
  if (weekly.unavailable || baseline.unavailable) return { ...weekly, unavailable: true };
  if (weekly.value <= 0 || baseline.value <= 0) return null;
  const value = (weekly.value / baseline.value - 1) * 100;
  return { value, receivedAtUs: weekly.receivedAtUs, unavailable: !Number.isFinite(value) };
}

const compareIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** The caller supplies the start roster and complete retained intake versions, not board winners.
 * This is neither an authorization check nor a public response encoder. */
export function scoreCoW(window: CoWWindow, metrics: readonly CoWMetric[],
  participants: readonly CoWParticipant[], versions: readonly CoWSetVersion[]): CoWResult {
  validateWindow(window, metrics);
  const readCutoff = Math.min(window.endUs, window.readBeforeUs);
  const changed = window.contextChangedAtUs;
  if (!window.context || (changed !== null && changed >= window.startUs && changed < readCutoff)) {
    return { state: 'unavailable', rankings: [] };
  }
  const roster = new Map<string, number>();
  for (const member of participants) {
    if (!member.memberId || roster.has(member.memberId)) throw new Error('Invalid CoW roster');
    if (member.endedAtUs !== null) {
      assertTime(member.endedAtUs);
      if (member.endedAtUs < window.startUs) throw new Error('Invalid CoW membership period');
    }
    roster.set(member.memberId, Math.min(readCutoff, member.endedAtUs ?? Infinity));
  }
  const rows = versions.filter(row => roster.has(row.memberId) && row.receivedAtUs < roster.get(row.memberId)!);
  rows.forEach(row => validateVersion(row, window.context!));
  rows.sort((a, b) => a.receivedAtUs - b.receivedAtUs || a.version - b.version || compareIds(a.setId, b.setId));
  const rankings: CoWRanking[] = metrics.map(metric => ({ metric,
    unit: metric === 'improvement' ? 'percent' : competitionUnit(metric, window.context!.normalized),
    entries: [], unavailableMemberIds: [] }));
  for (const member of participants) {
    const cutoff = Math.min(readCutoff, member.endedAtUs ?? Infinity);
    const states = memberStates(rows.filter(row => row.memberId === member.memberId), window, cutoff);
    for (const ranking of rankings) {
      const result = memberValue(states, ranking.metric);
      if (!result) continue;
      if (result.unavailable) ranking.unavailableMemberIds.push(member.memberId);
      else if (ranking.metric === 'improvement' || result.value > 0) {
        ranking.entries.push({ memberId: member.memberId, value: result.value, receivedAtUs: result.receivedAtUs, rank: 0 });
      }
    }
  }
  for (const ranking of rankings) {
    ranking.entries.sort((a, b) => b.value - a.value || a.receivedAtUs - b.receivedAtUs || compareIds(a.memberId, b.memberId));
    ranking.entries.forEach((entry, index) => { entry.rank = index + 1; });
    ranking.unavailableMemberIds.sort(compareIds);
  }
  return { state: 'ready', rankings };
}
