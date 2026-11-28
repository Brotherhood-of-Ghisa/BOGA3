import type { MeetListWire, MeetWire } from './meet-wire';

/** Today shows a meet from this long before it starts until this long after it ends. */
export const TODAY_MEET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Ms from `now` to the meet's window: 0 while it is on, else to its start or since its end. */
const distanceMs = (meet: MeetWire, now: number): number =>
  now < meet.starts_at_ms ? meet.starts_at_ms - now : now > meet.ends_at_ms ? now - meet.ends_at_ms : 0;

/** [[meets.today-card]]: both window edges are included; a cancelled meet is never shown. */
export const isTodayMeet = (meet: MeetWire, now: number): boolean =>
  meet.cancelled_at_ms === null && now >= meet.starts_at_ms - TODAY_MEET_WINDOW_MS && now <= meet.ends_at_ms + TODAY_MEET_WINDOW_MS;

/** The one meet Today's card shows ([[meets.today-card]]); the earlier start and the ID break remaining ties so the choice never flickers. */
export function pickTodayMeet(list: MeetListWire, now: number): MeetWire | null {
  const candidates = [...list.upcoming, ...list.past].filter(meet => isTodayMeet(meet, now));
  candidates.sort((a, b) => distanceMs(a, now) - distanceMs(b, now) || Number(b.starts_at_ms > now) - Number(a.starts_at_ms > now) ||
    a.starts_at_ms - b.starts_at_ms || (a.meet_id < b.meet_id ? -1 : a.meet_id > b.meet_id ? 1 : 0));
  return candidates[0] ?? null;
}
