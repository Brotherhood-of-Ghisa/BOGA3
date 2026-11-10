/**
 * Outcome: an agent can only modify a session plan or programme with valid wire
 * shapes, bounded fields, validated set structures, and explicit optimistic
 * concurrency tokens (base_version).
 *
 * The Edge Function (supabase/functions/agent-api) applies these pure rules
 * before invoking service-role mutation RPCs.
 */

import {
  MAX_BLOCK_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_PLAN_BLOCKS,
  MAX_PLAN_SETS,
  MAX_PLAN_TITLE_LENGTH,
  MAX_PROGRAMME_NAME_LENGTH,
  MAX_PROGRAMME_PLANS,
  MIN_PROGRAMME_PLANS,
  PlanEditError,
  normalizePlanMutation,
  normalizeProgrammeMutation,
  readBaseVersion,
} from '../../../supabase/functions/agent-api/plan-edit.ts';

const rejection = (read: () => unknown): string => {
  try {
    read();
  } catch (error) {
    if (error instanceof PlanEditError) return error.message;
    throw error;
  }
  throw new Error('expected a PlanEditError');
};

const BASE_VERSION = '2026-10-24T12:00:00.123456Z';

describe('plan base_version validation', () => {
  it('reads and trims a valid base_version', () => {
    expect(readBaseVersion('  ' + BASE_VERSION + '  ')).toBe(BASE_VERSION);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty string', '   '],
    ['non-string', 12345],
  ])('rejects %s base_version', (_label, value) => {
    expect(rejection(() => readBaseVersion(value))).toBe('base_version is required.');
  });
});

describe('agent plan mutations', () => {
  describe('update_plan_meta', () => {
    it('normalizes valid plan meta update with explicit operation', () => {
      const mutation = normalizePlanMutation({
        operation: 'update_plan_meta',
        base_version: BASE_VERSION,
        title: '  Upper Body Power  ',
        gym_id: 'gym-123',
        scheduled_for: '2026-10-25T10:00:00Z',
      });
      expect(mutation).toEqual({
        kind: 'update_plan_meta',
        base_version: BASE_VERSION,
        patch: {
          title: 'Upper Body Power',
          gym_id: 'gym-123',
          scheduled_for: Date.parse('2026-10-25T10:00:00Z'),
        },
      });
    });

    it('infers update_plan_meta from patch fields', () => {
      const mutation = normalizePlanMutation({
        base_version: BASE_VERSION,
        title: 'Leg Day',
        gym_id: null,
      });
      expect(mutation).toEqual({
        kind: 'update_plan_meta',
        base_version: BASE_VERSION,
        patch: {
          title: 'Leg Day',
          gym_id: null,
        },
      });
    });

    it('accepts epoch ms for scheduled_for', () => {
      const epochMs = 1792922400000;
      const mutation = normalizePlanMutation({
        base_version: BASE_VERSION,
        scheduled_for: epochMs,
      });
      expect(mutation).toEqual({
        kind: 'update_plan_meta',
        base_version: BASE_VERSION,
        patch: {
          scheduled_for: epochMs,
        },
      });
    });

    it('rejects empty title or title exceeding max length', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'update_plan_meta',
        base_version: BASE_VERSION,
        title: '   ',
      }))).toBe(`title must be 1 to ${MAX_PLAN_TITLE_LENGTH} characters.`);

      expect(rejection(() => normalizePlanMutation({
        operation: 'update_plan_meta',
        base_version: BASE_VERSION,
        title: 'a'.repeat(MAX_PLAN_TITLE_LENGTH + 1),
      }))).toBe(`title must be 1 to ${MAX_PLAN_TITLE_LENGTH} characters.`);
    });

    it('rejects unsupported fields in patch', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'update_plan_meta',
        base_version: BASE_VERSION,
        title: 'Upper',
        unknown_field: 'value',
      }))).toBe('Unsupported field: unknown_field');
    });

    it('rejects update when no fields provided', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'update_plan_meta',
        base_version: BASE_VERSION,
      }))).toBe('patch must update at least one field (title, gym_id, or scheduled_for).');
    });
  });

  describe('insert_plan_block', () => {
    it('normalizes valid block insert', () => {
      const mutation = normalizePlanMutation({
        operation: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_id: 'bench-press',
          name: 'Main Press',
          sets: [
            { target_reps: 8, target_weight: '80', target_set_type: 'warm_up' },
            { target_reps: 6, target_weight_value: '85.5', target_set_type: 'rir_2' },
          ],
        },
      });
      expect(mutation).toEqual({
        kind: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_definition_id: 'bench-press',
          name: 'Main Press',
          sets: [
            { target_reps: 8, target_weight_value: '80', target_set_type: 'warm_up' },
            { target_reps: 6, target_weight_value: '85.5', target_set_type: 'rir_2' },
          ],
        },
      });
    });

    it('rejects insert block with no sets', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_id: 'bench-press',
          sets: [],
        },
      }))).toBe(`block.sets must contain 1 to ${MAX_PLAN_SETS} sets.`);
    });

    it('rejects invalid target reps', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_id: 'bench-press',
          sets: [{ target_reps: 0 }],
        },
      }))).toBe('block.sets[0].target_reps must be an integer between 1 and 999.');

      expect(rejection(() => normalizePlanMutation({
        operation: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_id: 'bench-press',
          sets: [{ target_reps: 1000 }],
        },
      }))).toBe('block.sets[0].target_reps must be an integer between 1 and 999.');
    });

    it('rejects invalid set type', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'insert_plan_block',
        base_version: BASE_VERSION,
        block: {
          exercise_id: 'bench-press',
          sets: [{ target_reps: 5, target_set_type: 'invalid_type' }],
        },
      }))).toBe('block.sets[0].target_set_type is not a supported set type.');
    });
  });

  describe('update_plan_block', () => {
    it('normalizes block update with sets and name', () => {
      const mutation = normalizePlanMutation({
        operation: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        name: 'Back Squat Focus',
        sets: [{ target_reps: 5, target_weight: '100' }],
      });
      expect(mutation).toEqual({
        kind: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        block: {
          name: 'Back Squat Focus',
          sets: [{ target_reps: 5, target_weight_value: '100' }],
        },
      });
    });

    it('normalizes block update preserving explicit null exercise_definition_id', () => {
      const mutation = normalizePlanMutation({
        operation: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        exercise_definition_id: null,
      });
      expect(mutation).toEqual({
        kind: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        block: {
          exercise_definition_id: null,
        },
      });
    });

    it('normalizes nested block update preserving explicit null exercise_definition_id', () => {
      const mutation = normalizePlanMutation({
        operation: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        block: {
          exercise_definition_id: null,
        },
      });
      expect(mutation).toEqual({
        kind: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
        block: {
          exercise_definition_id: null,
        },
      });
    });

    it('rejects update when no fields provided', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'update_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'squat',
      }))).toMatch(/must provide at least one field to update/);
    });
  });

  describe('reorder_plan_blocks', () => {
    it('normalizes reorder blocks list', () => {
      const mutation = normalizePlanMutation({
        operation: 'reorder_plan_blocks',
        base_version: BASE_VERSION,
        exercise_ids: ['bench', 'row', 'overhead-press'],
      });
      expect(mutation).toEqual({
        kind: 'reorder_plan_blocks',
        base_version: BASE_VERSION,
        exercise_ids: ['bench', 'row', 'overhead-press'],
      });
    });

    it('rejects empty exercise_ids', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'reorder_plan_blocks',
        base_version: BASE_VERSION,
        exercise_ids: [],
      }))).toBe(`exercise_ids must be an array of 1 to ${MAX_PLAN_BLOCKS} block IDs.`);
    });
  });

  describe('reorder_block_sets', () => {
    it('normalizes reorder sets list', () => {
      const mutation = normalizePlanMutation({
        operation: 'reorder_block_sets',
        base_version: BASE_VERSION,
        exercise_id: 'bench',
        set_ids: ['set-2', 'set-1', 'set-3'],
      });
      expect(mutation).toEqual({
        kind: 'reorder_block_sets',
        base_version: BASE_VERSION,
        exercise_id: 'bench',
        set_ids: ['set-2', 'set-1', 'set-3'],
      });
    });

    it('rejects missing exercise_id when inferring reorder sets', () => {
      expect(rejection(() => normalizePlanMutation({
        base_version: BASE_VERSION,
        set_ids: ['set-1'],
      }))).toBe('exercise_id is required to reorder sets.');
    });
  });

  describe('tombstone_plan_block and tombstone_plan', () => {
    it('normalizes tombstone block when deleted is true with exercise_id', () => {
      const mutation = normalizePlanMutation({
        base_version: BASE_VERSION,
        exercise_id: 'bench',
        deleted: true,
      });
      expect(mutation).toEqual({
        kind: 'tombstone_plan_block',
        base_version: BASE_VERSION,
        exercise_id: 'bench',
      });
    });

    it('normalizes tombstone plan when deleted is true without exercise_id', () => {
      const mutation = normalizePlanMutation({
        base_version: BASE_VERSION,
        deleted: true,
      });
      expect(mutation).toEqual({
        kind: 'tombstone_plan',
        base_version: BASE_VERSION,
      });
    });

    it('normalizes explicit delete_plan operation', () => {
      const mutation = normalizePlanMutation({
        operation: 'delete_plan',
        base_version: BASE_VERSION,
      });
      expect(mutation).toEqual({
        kind: 'tombstone_plan',
        base_version: BASE_VERSION,
      });
    });
  });

  describe('unrecognized payloads', () => {
    it('rejects unsupported operation', () => {
      expect(rejection(() => normalizePlanMutation({
        operation: 'unsupported_op',
        base_version: BASE_VERSION,
      }))).toBe('Unsupported plan edit operation: unsupported_op');
    });

    it('rejects payload with no discernible operation', () => {
      expect(rejection(() => normalizePlanMutation({
        base_version: BASE_VERSION,
      }))).toBe('Unable to determine plan edit operation from request payload.');
    });
  });
});

describe('agent programme mutations', () => {
  describe('update_programme_meta', () => {
    it('normalizes programme meta update', () => {
      const mutation = normalizeProgrammeMutation({
        operation: 'update_programme_meta',
        base_version: BASE_VERSION,
        name: 'Hypertrophy Phase 1',
        description: '4-day upper lower split.',
      });
      expect(mutation).toEqual({
        kind: 'update_programme_meta',
        base_version: BASE_VERSION,
        patch: {
          name: 'Hypertrophy Phase 1',
          description: '4-day upper lower split.',
        },
      });
    });

    it('rejects description exceeding max length', () => {
      expect(rejection(() => normalizeProgrammeMutation({
        operation: 'update_programme_meta',
        base_version: BASE_VERSION,
        description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      }))).toBe(`description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`);
    });
  });

  describe('reorder_programme_plans', () => {
    it('normalizes plan reordering', () => {
      const mutation = normalizeProgrammeMutation({
        operation: 'reorder_programme_plans',
        base_version: BASE_VERSION,
        plan_ids: ['plan-1', 'plan-2', 'plan-3'],
      });
      expect(mutation).toEqual({
        kind: 'reorder_programme_plans',
        base_version: BASE_VERSION,
        plan_ids: ['plan-1', 'plan-2', 'plan-3'],
      });
    });

    it('rejects fewer than MIN_PROGRAMME_PLANS', () => {
      expect(rejection(() => normalizeProgrammeMutation({
        operation: 'reorder_programme_plans',
        base_version: BASE_VERSION,
        plan_ids: ['plan-1'],
      }))).toBe(`plan_ids must be an array of ${MIN_PROGRAMME_PLANS} to ${MAX_PROGRAMME_PLANS} plan IDs.`);
    });
  });

  describe('detach_programme_plan', () => {
    it('normalizes detaching a plan', () => {
      const mutation = normalizeProgrammeMutation({
        operation: 'detach_programme_plan',
        base_version: BASE_VERSION,
        plan_id: 'plan-2',
      });
      expect(mutation).toEqual({
        kind: 'detach_programme_plan',
        base_version: BASE_VERSION,
        plan_id: 'plan-2',
      });
    });
  });

  describe('tombstone_programme', () => {
    it('normalizes tombstone programme when deleted is true', () => {
      const mutation = normalizeProgrammeMutation({
        base_version: BASE_VERSION,
        deleted: true,
      });
      expect(mutation).toEqual({
        kind: 'tombstone_programme',
        base_version: BASE_VERSION,
      });
    });
  });
});
