import type { CompetitionBoardRowWire, CompetitionEventWire, CompetitionExerciseWire } from '@/src/groups/competition-wire';
import type { CoWResultWire, CoWSummaryWire } from '@/src/groups/cow-wire';
import type { CompetitionSessionCard } from '@/src/groups/competition-stream-view-model';

// Fixed public fixtures; gallery rendering uses the production presenters.
export const competitionExercise: CompetitionExerciseWire = { group_exercise_id: 'ge1',name: 'Pull-up',source_exercise_id: null,
  archived_at_ms: null,published_revision: 2,rebuilding: false,rules: { bodyweight_calculations_enabled: true,
    bodyweight_contribution: 1,load_input_mode: 'total_load',default_metric: 'e1rm',rules_revision: 2 } };
export const competitionRow: CompetitionBoardRowWire = { metric: 'e1rm',value: 145.7281316,unit: 'percent_bw',rank: 1,
  member: { user_id: 'other',username: 'Friend' },former: false,write_token: 'server-random-token',certification: null,
  performance: { visibility: 'normalized',session_id: 's1',session_exercise_id: 'se1',exercise_definition_id: 'ed1',
    set_id: 'set1',reps: 5,performance_status: null,source_load_input_mode: 'total_load',achieved_at_ms: 2_000,
    exercise_order_index: 0,set_order_index: 0 } };
export const competitionEvent: CompetitionEventWire = {
  event_id: 'event1',sequence: 1,kind: 'record',group: { group_id: 'g1',name: 'Crew' },
  group_exercise: { group_exercise_id: 'ge1',name: 'Pull-up' },rules_revision: 2,representation_version: 4,
  visibility: 'normalized',sort_at_ms: 2000,member: competitionRow.member,metric: 'e1rm',certified: false,
  reason: null,related_event_id: null,session_id: 's1',set_id: 'set1',reps: 5,provisional: false,voided: false,
  values: [{ role: 'record',metric: 'e1rm',unit: 'percent_bw',value: competitionRow.value,unavailable: false,member: competitionRow.member }],
  record_context: { exercise: competitionExercise,former: false,
    metrics: [{ metric: 'e1rm',write_token: competitionRow.write_token,eligible: true,certification: null }] },
};
export const cowResult = (): CoWResultWire => ({
  cow: { cow_id: 'cow1', group_id: 'g1', group_exercise_id: 'ge1', week_start: '2026-10-26', time_zone: 'Europe/London',
    starts_at_us: 1792972800000000, ends_at_us: 1793577600000000, metrics: ['e1rm', 'volume', 'improvement'], revision: 1, state: 'active' },
  exercise: { ...competitionExercise }, bodyweight_calculations_enabled: true, state: 'ready', normalized: true, publication_id: 'publication1',
  rankings: [
    { metric: 'e1rm', unit: 'percent_bw', entries: [{ rank: 1, member: { user_id: 'u1', username: 'Me' }, former: false, value: 150, state: 'ranked' }], entry_count: 1, next_cursor: null },
    { metric: 'volume', unit: 'percent_bw_reps', entries: [], entry_count: 1, next_cursor: null },
    { metric: 'improvement', unit: 'percent', entries: [], entry_count: 1, next_cursor: null },
  ],
});
export const cowSummary = (): CoWSummaryWire => ({ group_id: 'g1', week_start: '2026-10-26', calendar_revision: 1,
  observed_at_us: 1793404800000000, valid_until_us: 1793577600000000, selection: 'current', result: cowResult() });


export const gallerySession: CompetitionSessionCard = {
  kind: 'session', key: 'reference', groupId: 'g1', memberUserId: 'u1', sessionId: 's1', memberName: 'Alex',
  isTrainingNow: true, statusLabel: 'Training now', startedAtLabel: 'Today · 11:30', gymName: 'Iron Works',
  groupNames: ['Iron Wednesdays'], setsLabel: '18 sets', exercisesLabel: '4 exercises',
  records: [{ key: 'record', exercise: 'Bench press', value: '1RM 102.5', certified: false, accessibilityLabel: 'Bench press, 1RM 102.5' }],
  groupRecordCount: 1, personalRecordCount: 2,
};
competitionEvent.sort_at_ms = new Date(2026, 9, 30, 11).getTime();

export const GALLERY_STATES = [
  { value: 'ready', label: 'Ready' }, { value: 'past', label: 'Past' },
  { value: 'pending', label: 'Pending' }, { value: 'unavailable', label: 'Unavailable' },
  { value: 'empty', label: 'Empty' }, { value: 'absent', label: 'Absent' },
  { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' },
  { value: 'offline', label: 'Offline' },
] as const;
export type GalleryState = typeof GALLERY_STATES[number]['value'];
export const COW_GALLERY_STATES = GALLERY_STATES.filter(item =>
  ['ready', 'past', 'pending', 'unavailable', 'empty'].includes(item.value));
export const GALLERY_SAMPLES = [
  { value: 'stream', label: 'Stream' }, { value: 'cow', label: 'CoW' }, { value: 'embedded', label: 'Today' },
  { value: 'summary', label: 'Summary' },
] as const;
export type GallerySample = typeof GALLERY_SAMPLES[number]['value'];

export function galleryCow(state: GalleryState, long: boolean): CoWResultWire {
  const result = cowResult();
  if (long && result.exercise) result.exercise.name = 'Chest supported row with a very long exercise name';
  if (long) result.rankings[0].entries[0].member.username = 'Contessa Serbelloni Mazzanti Vien dal Mare';
  if (state === 'past') result.cow = { ...result.cow, state: 'final', week_start: '2026-10-19',
    starts_at_us: result.cow.starts_at_us - 7 * 86400000000, ends_at_us: result.cow.starts_at_us };
  if (state === 'pending' || state === 'unavailable') {
    result.state = state;
    result.rankings.forEach(ranking => { ranking.entries = []; });
  }
  if (state === 'empty') result.rankings.forEach(ranking => { ranking.entries = []; ranking.entry_count = 0; });
  return result;
}
