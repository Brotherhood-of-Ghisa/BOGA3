import { groupHomeSeriesWindows, type GroupHomeMemberTotals } from '@/src/groups/home-periods';
import { buildWeekBoard } from '@/src/groups/week-summary-view-model';

export const LIST_GALLERY_NOW = new Date(2026, 9, 30, 12);
export const LIST_GALLERY_STATES = [
  { value: 'ready', label: 'Ready' }, { value: 'own', label: 'Own row' },
  { value: 'ties', label: 'Ties' }, { value: 'empty', label: 'Empty' },
  { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' },
  { value: 'offline', label: 'Offline' },
] as const;
export type ListGalleryState = typeof LIST_GALLERY_STATES[number]['value'];

export function listGalleryMembers(state: ListGalleryState, long: boolean): GroupHomeMemberTotals[] {
  if (state === 'empty') return [];
  return ['Alex', 'Maria', 'Sam', 'Jules', 'Luca', 'You'].map((name, index) => {
    const sets = state === 'own' && index === 5 ? 140 : state === 'ties' && index === 1 ? 128 : [128, 115, 98, 82, 74, 58][index];
    const prs = state === 'ties' && index === 1 ? 4 : [4, 3, 2, 2, 1, 1][index];
    return {
    userId: index === 5 ? 'me' : `u${index}`, isMe: index === 5,
    name: long && index === 0 ? 'Contessa Serbelloni Mazzanti Vien dal Mare' : name,
    sets: sets + (long ? 123328 : 0),
    prs: prs + (long ? 12341 : 0),
  }; });
}

export function listGalleryWeekBoard(state: ListGalleryState, long: boolean) {
  const members = listGalleryMembers(state, long);
  if (state === 'own') members.unshift(members.pop()!);
  return buildWeekBoard(members.map((member, index) => ({
    rank: state === 'ties' && index === 1 ? 1 : index + 1,
    member: { user_id: member.userId, username: member.name },
    working_sets: member.sets, group_records: member.prs,
  })), 'me');
}

export function listGallerySeries(state: ListGalleryState, long: boolean) {
  return groupHomeSeriesWindows({ period: 'week', offset: 0, now: LIST_GALLERY_NOW }).map(window => ({
    window, members: listGalleryMembers(state, long),
  }));
}
