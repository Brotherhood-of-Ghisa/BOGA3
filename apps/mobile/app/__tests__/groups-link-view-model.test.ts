/**
 * Outcome (M25-T07 AC3): the linking rules are pure and fully decided here —
 * soft-deleted exercises are never offered, one link per group shows as
 * unavailable, archived group exercises are not offered but existing links to
 * them render, the suggestion order and exclusions, inactive links for groups
 * I've left, placeholders for missing cache entries, the load-mode note in
 * both directions, and the default picker list staying free of group rows.
 */

import {
  ARCHIVED_LINK_LABEL,
  INACTIVE_LINK_LABEL,
  PLACEHOLDER_GROUP_EXERCISE_NAME,
  PLACEHOLDER_GROUP_NAME,
  buildLinkScreenModel,
  buildPickSheetModel,
  buildPickerGroupSections,
  describeLinkRetroactivity,
  describeLoadModeNote,
  describeUnlinkConfirm,
  filterPickSheetChoices,
  nameMatchScore,
  resolvePickerGroupSelection,
  suggestExerciseForGroupExercise,
  type GroupExerciseCatalog,
  type LinkRef,
  type LinkableExercise,
} from '@/src/groups/link-view-model';
import type { GroupExercise } from '@/src/groups/types';

const groupExercise = (overrides: Partial<GroupExercise> & Pick<GroupExercise, 'group_exercise_id' | 'name'>): GroupExercise => ({
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

const exercise = (overrides: Partial<LinkableExercise> & Pick<LinkableExercise, 'id' | 'name'>): LinkableExercise => ({
  loadInputMode: 'total_load',
  deletedAt: null,
  ...overrides,
});

const GX_BENCH_IRON = groupExercise({ group_exercise_id: 'gx-bench-iron', name: 'Bench Press', source_exercise_id: 'seed_barbell_bench_press' });
const GX_DEADLIFT_IRON = groupExercise({ group_exercise_id: 'gx-deadlift-iron', name: 'Deadlift' });
const GX_OLD_IRON = groupExercise({ group_exercise_id: 'gx-old-iron', name: 'Bench (old)', archived_at_ms: 1 });
const GX_BENCH_TUE = groupExercise({ group_exercise_id: 'gx-bench-tue', name: 'Bench', load_input_mode: 'per_side_load' });

const IRON: GroupExerciseCatalog = {
  groupId: 'g-iron',
  groupName: 'Iron Brotherhood',
  exercises: [GX_BENCH_IRON, GX_DEADLIFT_IRON, GX_OLD_IRON],
};
const TUESDAY: GroupExerciseCatalog = { groupId: 'g-tue', groupName: 'Tuesday Crew', exercises: [GX_BENCH_TUE] };

const SEED_BENCH = exercise({ id: 'seed_barbell_bench_press', name: 'Barbell Bench Press' });
const COMP_BENCH = exercise({ id: 'ex-comp', name: 'Bench (comp grip)' });
const HOTEL_BENCH = exercise({ id: 'ex-hotel', name: 'Bench (hotel gym)', loadInputMode: 'per_side_load' });
const DELETED_BENCH = exercise({ id: 'ex-deleted', name: 'Bench', deletedAt: new Date(1) });
const SQUAT = exercise({ id: 'ex-squat', name: 'Squat' });

const EXERCISES = [SEED_BENCH, COMP_BENCH, HOTEL_BENCH, DELETED_BENCH, SQUAT];

const link = (exerciseDefinitionId: string, groupId: string, groupExerciseId: string): LinkRef => ({
  exerciseDefinitionId,
  groupId,
  groupExerciseId,
});

describe('notes', () => {
  it('load-mode note in both directions, none when the modes match', () => {
    expect(describeLoadModeNote('per_side_load', 'total_load')).toBe(
      "Your per-side weights will show doubled on this group's boards.",
    );
    expect(describeLoadModeNote('total_load', 'per_side_load')).toBe(
      "Your total-load weights will show halved on this group's boards.",
    );
    expect(describeLoadModeNote(undefined, 'per_side_load')).toBe(
      "Your total-load weights will show halved on this group's boards.",
    );
    expect(describeLoadModeNote('per_side_load', 'per_side_load')).toBeNull();
  });

  it('retroactivity and unlink wording (E0.2, E0.3)', () => {
    expect(describeLinkRetroactivity('Bench (comp grip)', 'Tuesday Crew')).toBe(
      'Your past Bench (comp grip) sets shared with Tuesday Crew will count.',
    );
    expect(describeUnlinkConfirm('Iron Brotherhood')).toBe(
      "Your sets from this exercise will leave Iron Brotherhood's leaderboards.",
    );
  });
});

describe('suggestion', () => {
  it('prefers my copy of the same standard exercise (source id match)', () => {
    expect(
      suggestExerciseForGroupExercise({ groupId: 'g-iron', groupExercise: GX_BENCH_IRON, exercises: EXERCISES, links: [] }),
    ).toBe(SEED_BENCH);
  });

  it('falls back to the best name match, never a deleted exercise', () => {
    expect(nameMatchScore('Bench', 'Bench')).toBe(3);
    expect(nameMatchScore('Bench (comp grip)', 'Bench')).toBe(2);
    expect(nameMatchScore('Bench', 'Bench Press')).toBe(1);
    expect(nameMatchScore('Squat', 'Bench')).toBe(0);

    // "Bench" (score 3) is deleted; three live exercises tie at score 2 and the
    // first by name wins.
    expect(
      suggestExerciseForGroupExercise({ groupId: 'g-tue', groupExercise: GX_BENCH_TUE, exercises: EXERCISES, links: [] }),
    ).toBe(SEED_BENCH);
  });

  it('skips the source match when it is already linked in that group', () => {
    // The seed copy is linked in Iron; nothing else matches "Bench Press".
    expect(
      suggestExerciseForGroupExercise({
        groupId: 'g-iron',
        groupExercise: GX_BENCH_IRON,
        exercises: EXERCISES,
        links: [link('seed_barbell_bench_press', 'g-iron', 'gx-deadlift-iron')],
      }),
    ).toBeNull();
  });

  it('skips name matches already linked in that group', () => {
    const links = [link('seed_barbell_bench_press', 'g-tue', 'gx-x'), link('ex-comp', 'g-tue', 'gx-y')];
    expect(
      suggestExerciseForGroupExercise({ groupId: 'g-tue', groupExercise: GX_BENCH_TUE, exercises: EXERCISES, links }),
    ).toBe(HOTEL_BENCH);
  });

  it('returns null with no candidate, so the pick sheet preselects Add as new', () => {
    const model = buildPickSheetModel({
      groupId: 'g-iron',
      groupName: 'Iron Brotherhood',
      groupExercise: GX_DEADLIFT_IRON,
      exercises: EXERCISES,
      links: [],
    });
    expect(model.suggestion).toBeNull();
    expect(model.defaultOption).toBe('add-new');
  });
});

describe('pick sheet', () => {
  it('lists only live exercises and marks those already linked in the group as unavailable', () => {
    const model = buildPickSheetModel({
      groupId: 'g-tue',
      groupName: 'Tuesday Crew',
      groupExercise: GX_BENCH_TUE,
      exercises: EXERCISES,
      links: [link('ex-squat', 'g-tue', 'gx-other')],
    });

    expect(model.defaultOption).toBe('suggested');
    expect(model.choices.map((choice) => choice.exercise.id)).toEqual([
      'seed_barbell_bench_press',
      'ex-comp',
      'ex-hotel',
      'ex-squat',
    ]);
    expect(model.choices.find((choice) => choice.exercise.id === 'ex-squat')?.unavailableReason).toBe(
      'already linked in Tuesday Crew',
    );
    expect(filterPickSheetChoices(model.choices, 'hotel').map((choice) => choice.exercise.id)).toEqual(['ex-hotel']);
  });
});

describe('picker group section (E0.1, D9, D13)', () => {
  it('is empty with no search text and the toggle off — the default list is unchanged', () => {
    expect(
      buildPickerGroupSections({ catalogs: [IRON, TUESDAY], links: [], exercises: EXERCISES, query: '  ', groupsOnly: false }),
    ).toEqual([]);
  });

  it('with search text, lists matching non-archived group exercises by group with their link status', () => {
    const sections = buildPickerGroupSections({
      catalogs: [IRON, TUESDAY],
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron'), link('ex-deleted', 'g-tue', 'gx-bench-tue')],
      exercises: EXERCISES,
      query: 'bench',
      groupsOnly: false,
    });

    expect(sections.map((section) => section.groupName)).toEqual(['Iron Brotherhood', 'Tuesday Crew']);
    expect(sections[0].rows.map((row) => [row.groupExercise.name, row.statusLabel])).toEqual([
      ['Bench Press', 'linked: Bench (comp grip)'],
    ]);
    // A link from a deleted exercise doesn't count: picking can't add a deleted exercise.
    expect(sections[1].rows.map((row) => [row.groupExercise.name, row.statusLabel])).toEqual([['Bench', 'not linked']]);
  });

  it('matches the group name too, and the toggle alone lists every group exercise', () => {
    const byGroupName = buildPickerGroupSections({
      catalogs: [IRON, TUESDAY],
      links: [],
      exercises: EXERCISES,
      query: 'tuesday',
      groupsOnly: false,
    });
    expect(byGroupName.map((section) => section.groupId)).toEqual(['g-tue']);

    const all = buildPickerGroupSections({ catalogs: [IRON, TUESDAY], links: [], exercises: EXERCISES, query: '', groupsOnly: true });
    expect(all.flatMap((section) => section.rows.map((row) => row.groupExercise.group_exercise_id))).toEqual([
      'gx-bench-iron',
      'gx-deadlift-iron',
      'gx-bench-tue',
    ]);
  });

  it('shows nothing while my groups are unknown and skips groups whose list is not cached', () => {
    expect(buildPickerGroupSections({ catalogs: null, links: [], exercises: EXERCISES, query: '', groupsOnly: true })).toEqual([]);
    expect(
      buildPickerGroupSections({
        catalogs: [{ ...IRON, exercises: null }, TUESDAY],
        links: [],
        exercises: EXERCISES,
        query: '',
        groupsOnly: true,
      }).map((section) => section.groupId),
    ).toEqual(['g-tue']);
  });

  it('picking: one linked exercise adds it, several open the chooser, none opens the pick sheet', () => {
    const [section] = buildPickerGroupSections({
      catalogs: [IRON],
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron'), link('ex-hotel', 'g-iron', 'gx-bench-iron')],
      exercises: EXERCISES,
      query: '',
      groupsOnly: true,
    });
    const [bench, deadlift] = section.rows;

    expect(bench.statusLabel).toBe('linked: Bench (comp grip), Bench (hotel gym)');
    expect(resolvePickerGroupSelection(bench)).toEqual({ kind: 'choose-linked', exercises: [COMP_BENCH, HOTEL_BENCH] });
    expect(resolvePickerGroupSelection({ ...bench, linkedExercises: [COMP_BENCH] })).toEqual({ kind: 'add', exercise: COMP_BENCH });
    expect(resolvePickerGroupSelection(deadlift)).toEqual({ kind: 'link' });
  });
});

describe('Link screen (E0.3)', () => {
  it('lists my links, suggests by source then name, and groups the rest; one link per group shows unavailable', () => {
    const model = buildLinkScreenModel({
      exercise: COMP_BENCH,
      catalogs: [IRON, TUESDAY],
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron')],
      query: '',
    });

    expect(model.canLink).toBe(true);
    expect(model.linked).toEqual([
      expect.objectContaining({ groupName: 'Iron Brotherhood', groupExerciseName: 'Bench Press', status: 'active', statusLabel: null }),
    ]);
    // Tuesday's Bench is a name match (comp grip contains "bench") → Suggested, not repeated below.
    expect(model.suggested.map((row) => row.key)).toEqual(['g-tue:gx-bench-tue']);
    expect(model.suggested[0].loadModeNote).toBe("Your total-load weights will show halved on this group's boards.");
    // Iron: the linked target is gone from the list, archived is never offered, Deadlift is unavailable.
    expect(model.groups).toEqual([
      {
        groupId: 'g-iron',
        groupName: 'Iron Brotherhood',
        rows: [expect.objectContaining({ key: 'g-iron:gx-deadlift-iron', unavailableReason: 'already linked in Iron Brotherhood' })],
      },
    ]);
  });

  it('a source match outranks a name match', () => {
    const model = buildLinkScreenModel({ exercise: SEED_BENCH, catalogs: [IRON, TUESDAY], links: [], query: '' });
    expect(model.suggested.map((row) => row.key)).toEqual(['g-iron:gx-bench-iron', 'g-tue:gx-bench-tue']);
  });

  it('search filters the offered rows only', () => {
    const model = buildLinkScreenModel({
      exercise: COMP_BENCH,
      catalogs: [IRON, TUESDAY],
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron')],
      query: 'dead',
    });
    expect(model.linked).toHaveLength(1);
    expect(model.suggested).toEqual([]);
    expect(model.groups.map((group) => group.rows.map((row) => row.key))).toEqual([['g-iron:gx-deadlift-iron']]);
  });

  it('a soft-deleted exercise offers nothing but still lists its links (b)', () => {
    const model = buildLinkScreenModel({
      exercise: DELETED_BENCH,
      catalogs: [IRON, TUESDAY],
      links: [link('ex-deleted', 'g-tue', 'gx-bench-tue')],
      query: '',
    });
    expect(model.canLink).toBe(false);
    expect(model.linked.map((row) => row.key)).toEqual(['g-tue:gx-bench-tue']);
    expect(model.suggested).toEqual([]);
    expect(model.groups).toEqual([]);
  });

  it('links to an archived group exercise and into a group I left render with their status (D8, P4)', () => {
    const model = buildLinkScreenModel({
      exercise: COMP_BENCH,
      catalogs: [IRON],
      links: [link('ex-comp', 'g-iron', 'gx-old-iron'), link('ex-comp', 'g-left', 'gx-gone')],
      query: '',
    });
    expect(model.linked.map((row) => [row.groupName, row.groupExerciseName, row.statusLabel])).toEqual([
      [PLACEHOLDER_GROUP_NAME, PLACEHOLDER_GROUP_EXERCISE_NAME, INACTIVE_LINK_LABEL],
      ['Iron Brotherhood', 'Bench (old)', ARCHIVED_LINK_LABEL],
    ]);
  });

  it('with my groups unknown (nothing cached), links render with placeholders and nothing is offered', () => {
    const model = buildLinkScreenModel({
      exercise: COMP_BENCH,
      catalogs: null,
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron')],
      query: '',
    });
    expect(model.linked).toEqual([
      expect.objectContaining({
        groupName: PLACEHOLDER_GROUP_NAME,
        groupExerciseName: PLACEHOLDER_GROUP_EXERCISE_NAME,
        status: 'active',
      }),
    ]);
    expect(model.suggested).toEqual([]);
    expect(model.groups).toEqual([]);
  });

  it('a group whose list is not cached keeps its link name as a placeholder but its group name', () => {
    const model = buildLinkScreenModel({
      exercise: COMP_BENCH,
      catalogs: [{ ...IRON, exercises: null }],
      links: [link('ex-comp', 'g-iron', 'gx-bench-iron')],
      query: '',
    });
    expect(model.linked[0]).toMatchObject({ groupName: 'Iron Brotherhood', groupExerciseName: PLACEHOLDER_GROUP_EXERCISE_NAME });
    expect(model.groups).toEqual([]);
  });
});
