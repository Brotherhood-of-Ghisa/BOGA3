import { formatBoardMemberLabel, formatOrdinal } from './board-view-model';
import type { CompetitionPodiumsWire } from './competition-wire';
import { formatMemberName } from './stream-view-model';

export type MedalRow = {
  userId: string;
  name: string;
  memberLabel: string;
  isMe: boolean;
  former: boolean;
  gold: number;
  silver: number;
  bronze: number;
  rank: number;
  accessibilityLabel: string;
};
export type MedalBoard = { state: 'ready' | 'rebuilding'; rows: MedalRow[]; me: MedalRow | null };

const compareMedals = (left: MedalRow, right: MedalRow): number =>
  right.gold - left.gold || right.silver - left.silver || right.bronze - left.bronze;

/** Derives [[groups.medals]] from the exercise cards' authorized payload. */
export function buildMedalBoard(payload: CompetitionPodiumsWire, userId: string): MedalBoard {
  const active = payload.podiums.filter(({ exercise, board }) => exercise.archived_at_ms === null && board.state !== 'archived');
  if (active.some(({ exercise, board }) => exercise.rebuilding || board.state === 'rebuilding')) {
    return { state: 'rebuilding', rows: [], me: null };
  }
  const members = new Map<string, MedalRow>();
  for (const { board } of active) {
    for (const entry of board.entries) {
      const medal = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : null;
      if (!medal) continue;
      const id = entry.member.user_id;
      const row = members.get(id) ?? {
        userId: id, name: formatMemberName(entry.member.username),
        memberLabel: formatBoardMemberLabel(entry.member, entry.former, userId),
        isMe: id === userId, former: entry.former,
        gold: 0, silver: 0, bronze: 0, rank: 0, accessibilityLabel: '',
      };
      row[medal] += 1;
      members.set(id, row);
    }
  }
  const rows = [...members.values()].sort((left, right) => compareMedals(left, right)
    || left.name.localeCompare(right.name) || (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));
  rows.forEach((row, index) => {
    row.rank = index > 0 && compareMedals(rows[index - 1], row) === 0 ? rows[index - 1].rank : index + 1;
    row.accessibilityLabel = [formatOrdinal(row.rank), row.isMe ? `You, ${row.name}` : row.name,
      row.former ? 'Former' : null, `Gold ${row.gold}`, `Silver ${row.silver}`, `Bronze ${row.bronze}`].filter(Boolean).join(', ');
  });
  return { state: 'ready', rows, me: rows.find(row => row.isMe) ?? null };
}
