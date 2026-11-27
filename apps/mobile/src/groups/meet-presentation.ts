import type { Href } from 'expo-router';
import type { GroupRole } from './types';
import type { MeetChallengeWire, MeetMetric, MeetState, MeetStreamItemWire, MeetWire } from './meet-wire';
import type { ExerciseDateFormat } from '../preferences/model';
import { formatCompactDate, formatShortDate } from '../utils/local-time';

export const meetHref = (groupId: string, meetId?: string): Href =>
  `/group/${encodeURIComponent(groupId)}/meets${meetId ? `/${encodeURIComponent(meetId)}` : ''}` as Href;
export const meetScheduleHref = (groupId: string, meetId?: string): Href =>
  `/group/${encodeURIComponent(groupId)}/meets/schedule${meetId ? `?meetId=${encodeURIComponent(meetId)}` : ''}` as Href;
export const meetTitle = (meet: Pick<MeetWire, 'title'>) => meet.title || 'Meet';
export const MEET_METRICS: Record<MeetMetric, string> = { e1rm: 'Best 1RM', weight: 'Best weight', reps: 'Max reps', volume: 'Volume', seconds: 'Hold seconds' };
export const meetMetrics = (hold: boolean): MeetMetric[] => hold ? ['seconds'] : ['e1rm', 'weight', 'reps', 'volume'];
export function meetState(meet: Pick<MeetWire, 'cancelled_at_ms' | 'starts_at_ms' | 'ends_at_ms' | 'cutoff_at_ms'>, now = Date.now()): MeetState {
  if (meet.cancelled_at_ms !== null) return 'cancelled';
  if (now < meet.starts_at_ms) return 'scheduled';
  if (now < meet.ends_at_ms) return 'live';
  return now < meet.cutoff_at_ms ? 'finalizing' : 'final';
}
export function meetPermissions(meet: MeetWire, role: GroupRole, now = Date.now()) {
  const state = meetState(meet, now);
  const manager = role === 'owner' || role === 'admin';
  return { manager, fields: manager && ['scheduled', 'live'].includes(state),
    cancel: manager && state === 'scheduled', challenges: state !== 'cancelled',
    join: state !== 'cancelled' && now < meet.cutoff_at_ms };
}
export const canEditMeetChallenge = (challenge: MeetChallengeWire, role: GroupRole, userId: string) =>
  role === 'owner' || role === 'admin' || challenge.author?.user_id === userId;

/** Render a group-zone instant using the user's calendar-date preference. */
export function meetDate(at: number, zone: string | null, format: ExerciseDateFormat, numeric = false): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  const date = new Date(Number(part('year')), Number(part('month')) - 1, Number(part('day')), 12);
  return `${numeric ? formatShortDate(date, format) : formatCompactDate(date, format)} · ${part('hour')}:${part('minute')}`;
}
export function meetCaption(meet: MeetWire, format: ExerciseDateFormat, now = Date.now(), numeric = false) {
  const state = meetState(meet, now);
  if (state === 'finalizing') return `Standings so far · final at ${meetDate(meet.cutoff_at_ms, meet.time_zone, format, numeric)}`;
  return { scheduled: 'Scheduled', live: 'Live', final: 'Final', cancelled: 'Cancelled' }[state];
}
export const MEET_STREAM_LABELS: Record<MeetStreamItemWire['event'], string> = {
  scheduled: 'Meet scheduled', on: 'Meet is on', results: 'Meet results', cancelled: 'Meet cancelled',
  results_refreshed: 'Results refreshed', challenge_changed: 'Challenge changed',
};
export function meetWriteMessage(code: string, offline = false) {
  if (offline) return "You're offline. Connect to the internet and try again.";
  if (code === 'CONFLICT') return 'This meet changed. Refresh and review before saving again. Your input is kept.';
  if (code === 'DUPLICATE') return 'This exercise and metric already has a challenge.';
  if (code === 'FORBIDDEN') return "You can't make this change. Refresh the meet.";
  if (code === 'VALIDATION') return 'Check the fields and try again.';
  if (code === 'NETWORK' || code === 'INTERNAL') return "Couldn't confirm the change. Check status before trying again.";
  return "Couldn't save. Refresh and try again.";
}
