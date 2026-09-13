/**
 * M25-T08 Exercises-segment rules (`src/groups/exercise-view-model.ts`; card
 * AC3, AC5, AC6): row order, link-status wording, the owner/admin action
 * matrix, exercise write wording, and the standard-exercise search.
 */

import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import {
  GroupApiError,
  NOT_LINKED_STATUS,
  STANDARD_EXERCISE_RESULT_LIMIT,
  buildGroupExerciseRows,
  describeGroupExerciseWriteError,
  formatGroupExerciseLinkStatus,
  groupExerciseActionSuccessMessage,
  groupExerciseActionsFor,
  groupExerciseArchiveConfirmation,
  searchStandardExercises,
  type GroupExercise,
  type GroupRole,
} from '@/src/groups';

const exercise = (id: string, name: string, overrides: Partial<GroupExercise> = {}): GroupExercise => ({
  group_exercise_id: id,
  name,
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

describe('formatGroupExerciseLinkStatus', () => {
  it('reads "Not linked" with no links', () => {
    expect(formatGroupExerciseLinkStatus([])).toBe(NOT_LINKED_STATUS);
    expect(NOT_LINKED_STATUS).toBe('Not linked');
  });

  it('lists my linked exercise names alphabetically', () => {
    expect(formatGroupExerciseLinkStatus(['Bench (hotel gym)', 'Bench (comp grip)'])).toBe(
      'Linked: Bench (comp grip), Bench (hotel gym)',
    );
  });

  it('reads "Linked" when none of the linked exercises is on this device, and skips the unnamed ones otherwise', () => {
    expect(formatGroupExerciseLinkStatus([null])).toBe('Linked');
    expect(formatGroupExerciseLinkStatus([null, 'Bench'])).toBe('Linked: Bench');
  });
});

describe('buildGroupExerciseRows', () => {
  const bench = exercise('ge-bench', 'Bench Press');
  const row = exercise('ge-row', 'Cable Row', { load_input_mode: 'per_side_load' });
  const old = exercise('ge-old', 'Old Squat', { archived_at_ms: 1_757_500_000_000 });

  it('puts active exercises first and archived ones last, each in server order', () => {
    const rows = buildGroupExerciseRows([old, bench, row], []);
    expect(rows.map((r) => r.groupExerciseId)).toEqual(['ge-bench', 'ge-row', 'ge-old']);
    expect(rows.map((r) => r.archived)).toEqual([false, false, true]);
  });

  it('labels the weight entry and joins my links by group exercise', () => {
    const rows = buildGroupExerciseRows(
      [bench, row],
      [
        { groupExerciseId: 'ge-bench', exerciseName: 'Bench (comp grip)' },
        { groupExerciseId: 'ge-bench', exerciseName: 'Bench (hotel gym)' },
      ],
    );
    expect(rows).toEqual([
      {
        groupExerciseId: 'ge-bench',
        name: 'Bench Press',
        loadInputModeLabel: 'Total load',
        archived: false,
        linkStatus: 'Linked: Bench (comp grip), Bench (hotel gym)',
      },
      { groupExerciseId: 'ge-row', name: 'Cable Row', loadInputModeLabel: 'Per side', archived: false, linkStatus: 'Not linked' },
    ]);
  });

  it('leaves the status out while my links are still loading', () => {
    expect(buildGroupExerciseRows([bench], null)[0].linkStatus).toBeNull();
  });
});

describe('groupExerciseActionsFor (contract §4.4: owner, admin)', () => {
  const active = { archived_at_ms: null };
  const archived = { archived_at_ms: 1 };

  it.each<[GroupRole, string[], string[]]>([
    ['owner', ['rename', 'archive'], ['unarchive']],
    ['admin', ['rename', 'archive'], ['unarchive']],
    ['member', [], []],
  ])('%s: active %j, archived %j', (role, onActive, onArchived) => {
    expect(groupExerciseActionsFor(role, active)).toEqual(onActive);
    expect(groupExerciseActionsFor(role, archived)).toEqual(onArchived);
  });
});

describe('exercise write wording', () => {
  it('confirms archive, saying links and boards are kept read-only', () => {
    const confirmation = groupExerciseArchiveConfirmation('Cable Row');
    expect(confirmation.title).toBe('Archive Cable Row?');
    expect(confirmation.message).toMatch(/read-only/);
    expect(confirmation.message).toMatch(/no longer offered for new links/);
    expect(confirmation.confirmLabel).toBe('Archive');
  });

  it('reports archive and unarchive success', () => {
    expect(groupExerciseActionSuccessMessage('archive', 'Cable Row')).toBe('Cable Row was archived.');
    expect(groupExerciseActionSuccessMessage('unarchive', 'Cable Row')).toBe('Cable Row is active again.');
  });

  it('describes refusals as "nothing changed" and points at the refreshed list', () => {
    expect(describeGroupExerciseWriteError(new GroupApiError('FORBIDDEN', 'forbidden'))).toMatch(/not allowed.*list has been refreshed/);
    expect(describeGroupExerciseWriteError(new GroupApiError('NOT_FOUND', 'group exercise not found'))).toMatch(
      /no longer available.*list has been refreshed/,
    );
    expect(
      describeGroupExerciseWriteError(new GroupApiError('VALIDATION', 'an archived group exercise is read-only; unarchive it first')),
    ).toBe('An archived group exercise is read-only; unarchive it first. Nothing was changed.');
    expect(describeGroupExerciseWriteError(new GroupApiError('NETWORK', 'Network request failed.'))).toMatch(/Nothing was changed/);
  });
});

describe('searchStandardExercises', () => {
  it('matches every typed word case-insensitively, sorted by name', () => {
    const { options } = searchStandardExercises('BENCH barbell');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.name.toLowerCase()).toContain('bench');
      expect(option.name.toLowerCase()).toContain('barbell');
    }
    const names = options.map((option) => option.name);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it('carries the seed id and load mode the create RPC needs', () => {
    const seed = SYSTEM_EXERCISE_DEFINITION_SEEDS.find((candidate) => candidate.id === 'seed_barbell_bench_press');
    expect(seed).toBeDefined();
    const match = searchStandardExercises(seed!.name).options.find((option) => option.sourceExerciseId === seed!.id);
    expect(match).toEqual({ sourceExerciseId: seed!.id, name: seed!.name, loadInputMode: seed!.loadInputMode });
  });

  it('caps the results but counts every match', () => {
    const all = searchStandardExercises('');
    expect(all.total).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(all.options).toHaveLength(Math.min(STANDARD_EXERCISE_RESULT_LIMIT, all.total));
  });

  it('returns nothing for an unmatched query', () => {
    expect(searchStandardExercises('zzz-no-such-lift')).toEqual({ options: [], total: 0 });
  });
});
