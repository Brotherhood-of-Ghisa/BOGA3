import type { ExerciseDateFormat } from '../preferences/model';
import { formatShortDate } from '../utils/local-time';
import type { MeetFields } from './api';
import type { MeetMetric, MeetWire } from './meet-wire';

export type MeetDraft = { title: string; date: string; start: string; endDate: string; end: string;
  venue: string; address: string; note: string; latitude: number | null; longitude: number | null };
export const defaultMeetEnd = (start: number) => start + 3 * 3600_000;
const zoneParts = (at: number, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
};
/** Convert group wall time to an instant; reject nonexistent DST times rather than shifting them. */
export function meetInstant(date: string, time: string, zone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let candidate = wall;
  for (let i = 0; i < 3; i++) {
    const actual = zoneParts(candidate, zone);
    candidate += wall - Date.parse(`${actual.date}T${actual.time}:00Z`);
  }
  const check = zoneParts(candidate, zone);
  return check.date === date && check.time === time ? candidate : null;
}
const dateLabel = (key: string, format: ExerciseDateFormat) => formatShortDate(new Date(`${key}T12:00:00`), format);
const dateKey = (label: string, format: ExerciseDateFormat) => {
  const parts = label.split('-');
  if (parts.length !== 3) return '';
  if (format === 'YYYY-MM-DD') return label;
  return `${parts[2]}-${parts[format === 'MM-DD-YYYY' ? 0 : 1]}-${parts[format === 'MM-DD-YYYY' ? 1 : 0]}`;
};
export function meetDraftFrom(meet: MeetFields, zone: string, format: ExerciseDateFormat = 'YYYY-MM-DD'): MeetDraft {
  const start = zoneParts(meet.starts_at_ms, zone); const end = zoneParts(meet.ends_at_ms, zone);
  return { title: meet.title ?? '', date: dateLabel(start.date, format), start: start.time, endDate: dateLabel(end.date, format), end: end.time,
    venue: meet.venue_name, address: meet.address ?? '', note: meet.entry_note ?? '', latitude: meet.latitude, longitude: meet.longitude };
}
export const emptyMeetDraft = (zone: string, format: ExerciseDateFormat = 'YYYY-MM-DD'): MeetDraft => meetDraftFrom({ title: null, starts_at_ms: Date.now() + 86400_000,
  ends_at_ms: defaultMeetEnd(Date.now() + 86400_000), venue_name: '', address: null, entry_note: null, latitude: null, longitude: null }, zone, format);
export function meetDraftFields(draft: MeetDraft, zone: string, format: ExerciseDateFormat = 'YYYY-MM-DD'): MeetFields | null {
  const starts = meetInstant(dateKey(draft.date, format), draft.start, zone); const ends = meetInstant(dateKey(draft.endDate, format), draft.end, zone);
  if (starts === null || ends === null || ends <= starts || ends - starts > 7 * 86400_000 || !draft.venue.trim()) return null;
  return { title: draft.title.trim() || null, starts_at_ms: starts, ends_at_ms: ends, venue_name: draft.venue.trim(),
    address: draft.address.trim() || null, entry_note: draft.note.trim() || null, latitude: draft.latitude, longitude: draft.longitude };
}
export function updateMeetDraft(draft: MeetDraft, key: keyof MeetDraft, value: string, zone: string, options: { defaultEnd: boolean; format?: ExerciseDateFormat }): MeetDraft {
  const { defaultEnd, format = 'YYYY-MM-DD' } = options;
  const next = { ...draft, [key]: value };
  if (key === 'address') { next.latitude = null; next.longitude = null; }
  if (defaultEnd && (key === 'date' || key === 'start')) {
    const instant = meetInstant(dateKey(next.date, format), next.start, zone);
    if (instant !== null) { const end = zoneParts(defaultMeetEnd(instant), zone); next.endDate = dateLabel(end.date, format); next.end = end.time; }
  }
  return next;
}
export const sameMeetFields = (meet: MeetWire, fields: MeetFields) => Object.entries(fields).every(([key, value]) => meet[key as keyof MeetFields] === value);

export type StagedMeetChallenge = { challengeId: string; exerciseId: string; exerciseName: string; metric: MeetMetric };
