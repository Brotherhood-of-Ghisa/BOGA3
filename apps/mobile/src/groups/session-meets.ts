// A member's sessions and the meets they train in ([[meets.linking]]): which
// cached meets a session can be joined to, the local Join/Leave that writes the
// synced link, the meet-page Leave that also tombstones this device's links, and
// which exercises are challenge exercises of a joined meet. Everything here
// reads the cached meet lists and details (`groups-contract.md` cache keys) and
// the member's local rows, so it works offline and never blocks the recorder.

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { listLinks } from '@/src/data/exercise-group-links';
import {
  joinSessionToMeet,
  leaveMeetSessions,
  leaveSessionMeet,
  listMeetLinksForSession,
  sessionCanOverlapMeet,
  SessionMeetClosedError,
  SessionMeetWindowError,
  type MeetWindow,
} from '@/src/data/session-meet-links';
import { runSyncCycle } from '@/src/sync/cycle';

import { groupCacheKeys, readGroupCache, type GroupCacheDatabase } from './cache';
import type { MeetDetailWire, MeetListWire, MeetWire } from './meet-wire';
import type { GroupListMineResult } from './types';

/** Where the offer is drawn: the recorder only inside a meet's window, the session page until its cutoff. */
export type SessionMeetPlacement = 'recorder' | 'page';

export type SessionMeetTimes = {
  status: 'active' | 'completed';
  startedAt: Date;
  completedAt: Date | null;
};

/** A cached meet with the name of the group it belongs to. */
export type SessionMeetCandidate = { meet: MeetWire; groupName: string };

export const toMeetWindow = (meet: Pick<MeetWire, 'meet_id' | 'starts_at_ms' | 'ends_at_ms' | 'cutoff_at_ms'>): MeetWindow => ({
  meetId: meet.meet_id,
  startsAtMs: meet.starts_at_ms,
  endsAtMs: meet.ends_at_ms,
  cutoffAtMs: meet.cutoff_at_ms,
});

/**
 * Every live meet in the member's cached group meet lists, soonest first. A
 * group whose meet list was never read, or a cache this account does not own,
 * contributes nothing: the banner never fetches.
 */
export const readCachedMeetCandidates = (database: GroupCacheDatabase, userId: string): SessionMeetCandidate[] => {
  const groups = readGroupCache<GroupListMineResult>(database, groupCacheKeys.mine, userId)?.payload.groups ?? [];
  const seen = new Set<string>();
  const candidates: SessionMeetCandidate[] = [];
  for (const group of groups) {
    const list = readGroupCache<MeetListWire>(database, groupCacheKeys.meets(group.group_id), userId)?.payload;
    for (const meet of [...(list?.upcoming ?? []), ...(list?.past ?? [])]) {
      if (meet.cancelled_at_ms !== null || seen.has(meet.meet_id)) continue;
      seen.add(meet.meet_id);
      candidates.push({ meet, groupName: group.name });
    }
  }
  return candidates.sort((a, b) => a.meet.starts_at_ms - b.meet.starts_at_ms || a.meet.meet_id.localeCompare(b.meet.meet_id));
};

/**
 * The meets a session can be joined to now. The recorder offers a meet while
 * `now` is inside its window; the session page offers it until its cutoff
 * (`ends_at + 24h`). Both require the session to overlap the window
 * (`sessionCanOverlapMeet`), so a link that could never count is never offered.
 */
export const offeredMeets = (
  candidates: readonly SessionMeetCandidate[],
  times: SessionMeetTimes,
  placement: SessionMeetPlacement,
  now: number,
): SessionMeetCandidate[] =>
  candidates.filter(({ meet }) => {
    const open = placement === 'recorder'
      ? now >= meet.starts_at_ms && now < meet.ends_at_ms
      : now < meet.cutoff_at_ms;
    return open && sessionCanOverlapMeet(times, toMeetWindow(meet));
  });

// ---- Change signal ---------------------------------------------------------

const listeners = new Set<() => void>();

/** Fires after a join or leave wrote local links, so mounted readers re-read. */
export const subscribeSessionMeetLinks = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notifySessionMeetLinksChanged = (): void => listeners.forEach((listener) => listener());

// ---- Reads -----------------------------------------------------------------

/** The meet ids a session is joined to (live links of the live session). */
export const joinedMeetIds = async (sessionId: string): Promise<Set<string>> =>
  new Set((await listMeetLinksForSession(sessionId)).map((link) => link.meetId));

/**
 * The exercise definitions of a session that are challenge exercises of a meet
 * the session is joined to: the exercise's live group link matches a live
 * challenge's group exercise in that meet's group. Challenges come from the
 * cached meet detail, so a meet whose detail was never read tags nothing.
 */
export const loadChallengeExerciseIds = async (
  userId: string,
  sessionId: string,
  definitionIds: readonly string[],
): Promise<Set<string>> => {
  const tagged = new Set<string>();
  if (definitionIds.length === 0) return tagged;
  const joined = await joinedMeetIds(sessionId);
  if (joined.size === 0) return tagged;
  const database = await bootstrapLocalDataLayer();
  const wanted = new Set(definitionIds);
  const links = (await listLinks()).filter((link) => wanted.has(link.exerciseDefinitionId));
  if (links.length === 0) return tagged;
  for (const { meet } of readCachedMeetCandidates(database, userId)) {
    if (!joined.has(meet.meet_id)) continue;
    const detail = readGroupCache<MeetDetailWire>(database, groupCacheKeys.meet(meet.group_id, meet.meet_id), userId);
    const challenged = new Set(detail?.payload.challenges.map((challenge) => challenge.group_exercise_id));
    for (const link of links) {
      if (link.groupId === meet.group_id && challenged.has(link.groupExerciseId)) {
        tagged.add(link.exerciseDefinitionId);
      }
    }
  }
  return tagged;
};

// ---- Writes ----------------------------------------------------------------

// The cutoff checks follow `Date.now()`, as the meet screens' own clock does.
const currentTime = (): Date => new Date(Date.now());

/** Why a Join or Leave from a session did not happen, in the app's words. */
export type SessionMeetFailure = 'closed' | 'window' | 'failed';

export const sessionMeetFailureMessage = (failure: SessionMeetFailure): string =>
  failure === 'closed'
    ? 'This meet has closed.'
    : failure === 'window'
      ? "This session doesn't overlap the meet."
      : "Couldn't update the meet. Try again.";

const classify = (error: unknown): SessionMeetFailure =>
  error instanceof SessionMeetClosedError ? 'closed' : error instanceof SessionMeetWindowError ? 'window' : 'failed';

export type SessionMeetResult = { ok: true } | { ok: false; failure: SessionMeetFailure };

/** Joins one session to a meet: the synced link only; the online Join is not called. */
export const joinMeetFromSession = async (sessionId: string, meet: MeetWire, now: Date = currentTime()): Promise<SessionMeetResult> => {
  try {
    await joinSessionToMeet(sessionId, toMeetWindow(meet), now);
    notifySessionMeetLinksChanged();
    return { ok: true };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
};

/** Leaves a meet for this session only: tombstones that session's link. */
export const leaveMeetFromSession = async (sessionId: string, meet: MeetWire, now: Date = currentTime()): Promise<SessionMeetResult> => {
  try {
    await leaveSessionMeet(sessionId, toMeetWindow(meet), now);
    notifySessionMeetLinksChanged();
    return { ok: true };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
};

export type MeetLeaveLinksResult = {
  /** Links this device tombstoned. */
  left: number;
  /** False when the pull that reaches other devices' links did not converge. */
  pulled: boolean;
};

/**
 * The local half of the meet page's Leave, run after the online leave RPC: pull
 * once so links made on another device reach this one, then tombstone every
 * live link this device holds for the meet. The server never writes a member's
 * Sync v2 rows, so this is the only way the leave reaches them. A pull that
 * fails (offline, a busy cycle) does not stop the local tombstones: links that
 * exist only on another device stay until that device syncs, and are removed
 * per session from its page. A link first synced here after this leave is not
 * touched.
 */
export const leaveMeetLinks = async (meet: MeetWire, now: Date = currentTime()): Promise<MeetLeaveLinksResult> => {
  const pulled = await runSyncCycle().then((outcome) => outcome === 'converged', () => false);
  const left = await leaveMeetSessions(toMeetWindow(meet), now);
  if (left > 0) notifySessionMeetLinksChanged();
  return { left, pulled };
};
