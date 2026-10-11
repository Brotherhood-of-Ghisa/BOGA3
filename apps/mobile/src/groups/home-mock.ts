/**
 * MOCK reads for the group home page's design target: a deterministic group
 * week or month, so the page can be drawn and reviewed before the server read
 * exists. Pure and offline — no API, no cache, no clock of its own.
 *
 * The shipped page replaces this with one window-scoped server summary; the
 * view-model shapes below are the request that read has to satisfy.
 */
import { localMonthWindow, localWeekWindow, type LocalWindow } from '@/src/utils/local-calendar';

/** The figure the board, the winners and the activity cards are ranked by. */
export type GroupHomeMetric = 'sets' | 'volume' | 'prs';
/** The period a board covers; the stepper walks back through them. */
export type GroupHomePeriod = 'week' | 'month';

export const GROUP_HOME_BOARD_SIZE = 5;
export const GROUP_HOME_ACTIVITY_SIZE = 5;
export const GROUP_HOME_WINNER_PERIODS = 4;

export type GroupHomeMemberTotals = {
  userId: string;
  name: string;
  isMe: boolean;
  sets: number;
  /** kg·reps over the window (`training-metrics-contract.md` §4). */
  volume: number;
  /** Group records taken in the window. */
  prs: number;
};

export type GroupHomeSession = {
  sessionId: string;
  userId: string;
  name: string;
  trainingNow: boolean;
  startedAtMs: number;
  gymName: string | null;
  sets: number;
  volume: number;
  prs: number;
};

export type GroupHomeWindow = {
  window: LocalWindow;
  /** Every current member's window totals, in no particular order. */
  members: GroupHomeMemberTotals[];
  /** The window's newest sessions first, the one in progress (if any) at the top. */
  sessions: GroupHomeSession[];
};

export const MOCK_GROUP_NAME = 'Brotherhood of Ghisa';
export const MOCK_MY_USER_ID = 'mock-user-me';

type MockMember = { userId: string; name: string; isMe?: boolean; /** Relative training load, 1 being the group's hardest trainer. */ form: number };

const MOCK_MEMBERS: MockMember[] = [
  { userId: MOCK_MY_USER_ID, name: 'You', isMe: true, form: 0.94 },
  { userId: 'mock-user-marco', name: 'Marco', form: 1 },
  { userId: 'mock-user-luca', name: 'Luca', form: 0.86 },
  { userId: 'mock-user-giovanni', name: 'Giovanni', form: 0.78 },
  { userId: 'mock-user-sara', name: 'Sara', form: 0.72 },
  { userId: 'mock-user-enzo', name: 'Enzo', form: 0.55 },
  { userId: 'mock-user-paolo', name: 'Paolo', form: 0.41 },
  { userId: 'mock-user-rocco', name: 'Rocco', form: 0.24 },
];

const MOCK_GYMS = ['Ghisa Milano', 'Palestra Centrale', 'Home rack', null];

// A stable 32-bit hash of the seed, so the same period always draws the same
// group: paging back and forth never reshuffles the board.
const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  }
  return hash >>> 0;
};

/** A deterministic 0..1 stream from a seed. */
const randomiser = (seed: string): (() => number) => {
  let state = hashSeed(seed);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const PERIOD_WINDOW: Record<GroupHomePeriod, (now: Date, offset: number) => LocalWindow> = {
  week: localWeekWindow,
  month: localMonthWindow,
};

export const groupHomeWindowFor = (period: GroupHomePeriod, now: Date, offset: number): LocalWindow =>
  PERIOD_WINDOW[period](now, offset);

/**
 * How much of the window has run: 1 for a window that has closed, the elapsed
 * share for the one in progress. The current period's figures are a part
 * total, so its board reads lower than a whole past one.
 */
const elapsedShare = (window: LocalWindow, nowMs: number): number => {
  if (nowMs >= window.end.getTime()) return 1;
  if (nowMs <= window.start.getTime()) return 0;
  const span = window.end.getTime() - window.start.getTime();
  return (nowMs - window.start.getTime()) / span;
};

const SETS_PER_FULL_WEEK = 64;
// kg·reps per working set, around the house's compound-session average.
const VOLUME_PER_SET = 2150;
const PRS_PER_FULL_WEEK = 3.2;

const memberTotals = (
  member: MockMember,
  random: () => number,
  weeks: number,
  share: number,
): GroupHomeMemberTotals => {
  // Form sets the member's level; the per-window jitter is what makes the
  // order change from one period to the next.
  const jitter = 0.78 + random() * 0.44;
  const level = member.form * jitter * weeks * share;
  const sets = Math.max(0, Math.round(SETS_PER_FULL_WEEK * level));
  return {
    userId: member.userId,
    name: member.name,
    isMe: member.isMe === true,
    sets,
    volume: Math.round(sets * VOLUME_PER_SET * (0.86 + random() * 0.3)),
    prs: Math.max(0, Math.round(PRS_PER_FULL_WEEK * level * (0.4 + random() * 1.4))),
  };
};

const HOUR_MS = 60 * 60 * 1000;

const mockSession = ({
  member,
  random,
  startedAtMs,
  trainingNow,
}: {
  member: GroupHomeMemberTotals;
  random: () => number;
  startedAtMs: number;
  trainingNow: boolean;
}): GroupHomeSession => {
  const sets = 6 + Math.round(random() * 12);
  return {
    sessionId: `mock-session-${member.userId}-${startedAtMs}`,
    userId: member.userId,
    name: member.name,
    trainingNow,
    startedAtMs,
    gymName: MOCK_GYMS[Math.floor(random() * MOCK_GYMS.length)] ?? null,
    sets,
    volume: Math.round(sets * VOLUME_PER_SET * (0.8 + random() * 0.4)),
    prs: random() > 0.62 ? 1 + Math.round(random() * 1.4) : 0,
  };
};

/**
 * The window's newest sessions: one in progress when the window is the current
 * one, then completed ones walking back from now (or from the window's end).
 */
const mockSessions = ({
  members,
  random,
  window,
  nowMs,
}: {
  members: GroupHomeMemberTotals[];
  random: () => number;
  window: LocalWindow;
  nowMs: number;
}): GroupHomeSession[] => {
  const current = nowMs >= window.start.getTime() && nowMs < window.end.getTime();
  const newest = current ? nowMs : window.end.getTime() - 6 * HOUR_MS;
  const trainers = members.filter((member) => !member.isMe);
  const sessions: GroupHomeSession[] = [];
  if (current) {
    const trainer = trainers[Math.floor(random() * trainers.length)] ?? members[0];
    if (trainer) {
      sessions.push(mockSession({ member: trainer, random, startedAtMs: newest - 52 * 60 * 1000, trainingNow: true }));
    }
  }
  let startedAtMs = newest - (current ? 9 : 2) * HOUR_MS;
  while (sessions.length < GROUP_HOME_ACTIVITY_SIZE) {
    const member = members[Math.floor(random() * members.length)];
    if (member) sessions.push(mockSession({ member, random, startedAtMs, trainingNow: false }));
    startedAtMs -= (11 + Math.floor(random() * 20)) * HOUR_MS;
  }
  return sessions;
};

/**
 * One mock window read: the group's member totals and its newest sessions.
 * `offset` 0 is the current period, -1 the one before it.
 */
export const readGroupHomeWindow = ({
  period,
  offset,
  now,
}: {
  period: GroupHomePeriod;
  offset: number;
  now: Date;
}): GroupHomeWindow => {
  const window = groupHomeWindowFor(period, now, offset);
  const random = randomiser(`${period}:${window.start.getTime()}`);
  const weeks = period === 'week' ? 1 : 4.35;
  const share = elapsedShare(window, now.getTime());
  const members = MOCK_MEMBERS.map((member) => memberTotals(member, random, weeks, share));
  return { window, members, sessions: mockSessions({ members, random, window, nowMs: now.getTime() }) };
};
