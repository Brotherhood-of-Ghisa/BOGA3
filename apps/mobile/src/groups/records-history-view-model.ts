import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatBoardDate } from './board-view-model';
import { streamRecordSet } from './competition-stream-view-model';
import type { CompetitionMetric } from './competition-contract';
import { competitionDisplayValue, formatCompetitionFigure, formatCompetitionHistoricalFigure } from './competition-view-model';
import type { CompetitionHistoryValueWire, CompetitionRecordsHistoryItemWire } from './competition-wire';
import { formatMemberName } from './stream-view-model';

/** `lead`: the entry took (or raised) the board's #1. `best`: a member's own new best only. */
export type RecordsLogMark = 'lead' | 'best';

export type RecordsLogEntry = {
  kind: 'entry'; key: string; mark: RecordsLogMark; title: string; figure: string;
  /** The set and what it beat: `82.0 × 12 · passed Sam`, `86.0 × 5 · +4.1 on best`. */
  detail: string; date: string;
  /** Scored under rules the board no longer uses: drawn dimmed, figures as scored then. */
  earlierRules: boolean;
  /** Its place in its run of entries between rules changes (one card per run). */
  index: number; count: number;
};
export type RecordsLogDivider = { kind: 'rules_change'; key: string; label: string };
export type RecordsLogRow = RecordsLogEntry | RecordsLogDivider;

type Member = { user_id: string; username: string | null } | null | undefined;

function delta(current: CompetitionHistoryValueWire | undefined, previous: CompetitionHistoryValueWire | null): string | null {
  if (!current || !previous || current.unit !== previous.unit || current.unavailable || previous.unavailable) return null;
  const now = competitionDisplayValue(current), before = competitionDisplayValue(previous);
  if (now === null || before === null || !Number.isFinite(now - before)) return null;
  return `+${formatCompetitionFigure(now - before, current.unit)} on best`;
}

function entryFor(item: CompetitionRecordsHistoryItemWire, metric: CompetitionMetric, userId: string | null,
  currentRevision: number, dateFormat: ExerciseDateFormat): Omit<RecordsLogEntry, 'index' | 'count'> {
  const { event, record } = item;
  const nameOf = (member: Member) => member?.user_id === userId ? 'You' : formatMemberName(member?.username ?? null);
  const date = event.provisional ? `${formatBoardDate(event.sort_at_ms, dateFormat)} · Session in progress`
    : formatBoardDate(event.sort_at_ms, dateFormat);
  const base = { kind: 'entry' as const, key: event.event_id, date, earlierRules: event.rules_revision < currentRevision };
  if (event.kind === 'lead_change') {
    const leader = event.values.find(value => value.role === 'leader');
    const previous = event.values.find(value => value.role === 'previous');
    const holder = leader?.member ?? event.member;
    const passed = previous?.member && previous.member.user_id !== holder?.user_id ? `passed ${nameOf(previous.member)}` : null;
    return { ...base, mark: 'lead', title: `${nameOf(holder)} took #1`,
      figure: leader ? formatCompetitionHistoricalFigure(leader) : 'Score unavailable', detail: passed ?? '' };
  }
  const value = event.values.find(entry => entry.role === 'record' && entry.metric === metric);
  const lead = record?.group_record_metrics.includes(metric) ?? false;
  const previousHolder = record?.previous.find(entry => entry.value.metric === metric)?.value.member;
  const tookFromOther = lead && previousHolder?.user_id !== event.member?.user_id;
  const name = nameOf(event.member);
  const beat = tookFromOther ? (previousHolder ? `passed ${nameOf(previousHolder)}` : null)
    : item.previous_best ? delta(value, item.previous_best) : 'first entry';
  return { ...base, mark: lead ? 'lead' : 'best', title: tookFromOther ? `${name} took #1` : lead ? `${name} · #1` : name,
    figure: value ? formatCompetitionHistoricalFigure(value) : 'Score unavailable',
    detail: [streamRecordSet(event, record ?? undefined), beat].filter(Boolean).join(' · ') };
}

/**
 * The records log, newest first: one entry per new best (All) or new #1
 * (Certified), and a divider at each rules change. Entries between two
 * dividers share one card; entries under earlier rules are marked to dim.
 */
export function buildRecordsLog(items: readonly CompetitionRecordsHistoryItemWire[], { metric, userId, currentRevision, dateFormat }: {
  metric: CompetitionMetric; userId: string | null; currentRevision: number; dateFormat: ExerciseDateFormat;
}): RecordsLogRow[] {
  const rows: RecordsLogRow[] = [];
  let run: Omit<RecordsLogEntry, 'index' | 'count'>[] = [];
  const flush = () => {
    rows.push(...run.map((entry, index) => ({ ...entry, index, count: run.length })));
    run = [];
  };
  for (const item of items) {
    if (item.event.kind === 'rules_change') {
      flush();
      rows.push({ kind: 'rules_change', key: item.event.event_id,
        label: `Rules changed · ${formatBoardDate(item.event.sort_at_ms, dateFormat)}` });
    } else {
      run.push(entryFor(item, metric, userId, currentRevision, dateFormat));
    }
  }
  flush();
  return rows;
}
