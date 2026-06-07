/**
 * FK integrity of the `muscle_groups` parent layer under enforcement.
 *
 * `exercise_muscle_mappings.muscle_group_id` is a NOT NULL local FK into
 * `muscle_groups`. `muscle_groups` is a Layer 0 synced parent of the Layer 1
 * mapping, so on the first-sign-in / reinstall re-pull the parent rows drain
 * before the child page lands and the FK is satisfied. This is the infra-free
 * regression guard for the bug class where that ordering is violated: a pulled
 * mapping referencing an absent muscle group aborts the whole pull page.
 *
 * This test closes that gap in the fast lane: it seeds the `muscle_groups`
 * bundle into a real, fully-migrated in-memory `better-sqlite3` database with
 * `PRAGMA foreign_keys = ON` (the enforcement we enable at boot via
 * `PRAGMA foreign_keys = ON`), then exercises the exact production path — a
 * pulled mapping referencing a *present* muscle group and a *pulled* exercise
 * definition — and asserts it inserts cleanly. The negative control proves the
 * parent layer is load-bearing: with the FK enforced and `muscle_groups` empty,
 * the same insert fails. The hard-asserted FK-present check below is meant to
 * fail loudly if the client FK is ever dropped, so this guard is revisited
 * deliberately rather than silently passing against a dropped FK.
 */

import {
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  muscleGroups,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

// Seeds the `muscle_groups` taxonomy bundle — the Layer 0 parent rows that a
// pulled mapping's FK references. In production these arrive via the generic
// synced-entity drain (Layer 0 before Layer 1); inserting the bundle directly is
// the minimal stand-in for that drained parent layer.
const seedMuscleGroupParents = (fixture: InMemoryDatabaseFixture): void => {
  const now = new Date();
  for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
    fixture.database
      .insert(muscleGroups)
      .values({ ...muscleGroup, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: muscleGroups.id })
      .run();
  }
};

const muscleGroupCount = (fixture: InMemoryDatabaseFixture): number =>
  fixture.database.select().from(muscleGroups).all().length;

// A pulled exercise definition (in a sync-configured build the catalog arrives
// via the pull leg from the server, exactly like this).
const insertPulledDefinition = (fixture: InMemoryDatabaseFixture, id: string): void => {
  fixture.database.insert(exerciseDefinitions).values({ id, name: 'Bench Press' }).run();
};

// The pulled mapping itself: references a (pulled) definition and a
// (parent-layer) muscle group.
const insertPulledMapping = (
  fixture: InMemoryDatabaseFixture,
  args: { id: string; exerciseDefinitionId: string; muscleGroupId: string },
): void => {
  fixture.database
    .insert(exerciseMuscleMappings)
    .values({
      id: args.id,
      exerciseDefinitionId: args.exerciseDefinitionId,
      muscleGroupId: args.muscleGroupId,
      weight: 1,
    })
    .run();
};

// The `muscle_groups` FK on `exercise_muscle_mappings`, read straight from the
// migrated schema. Hard-asserting it exists is what makes this suite fail loudly
// if the client FK is ever dropped, rather than silently passing.
const muscleGroupForeignKey = (
  fixture: InMemoryDatabaseFixture,
): { table: string; from: string; to: string } | undefined =>
  (
    fixture.client.pragma(
      "foreign_key_list('exercise_muscle_mappings')",
    ) as { table: string; from: string; to: string }[]
  ).find((fk) => fk.table === 'muscle_groups');

describe('muscle_groups parent-layer FK integrity (satisfies the pulled-mapping FK)', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    // FK enforcement ON — the same as the production expo-sqlite handle, and the
    // whole point of this suite. Without it the negative control could not fail.
    fixture = createInMemoryDatabase({ foreignKeys: true });
  });

  afterEach(() => {
    fixture.close();
  });

  it('populates the muscle_groups taxonomy parent layer', () => {
    expect(muscleGroupCount(fixture)).toBe(0);

    seedMuscleGroupParents(fixture);

    // The parent layer holds the full bundle once drained.
    expect(muscleGroupCount(fixture)).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
  });

  it('lets a pulled mapping referencing a present muscle group insert cleanly under an enforced FK', () => {
    seedMuscleGroupParents(fixture);

    const definitionId = 'pulled-def-1';
    insertPulledDefinition(fixture, definitionId);

    // The mapping points at a muscle group present in the parent layer — the
    // production sync-configured path. With FKs enforced this must not throw.
    expect(() =>
      insertPulledMapping(fixture, {
        id: 'pulled-map-1',
        exerciseDefinitionId: definitionId,
        muscleGroupId: SYSTEM_MUSCLE_GROUP_SEEDS[0].id,
      }),
    ).not.toThrow();

    const mappings = fixture.database.select().from(exerciseMuscleMappings).all();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.muscleGroupId).toBe(SYSTEM_MUSCLE_GROUP_SEEDS[0].id);
  });

  it('fails the pulled-mapping insert when the parent layer is empty (the parent layer is load-bearing)', () => {
    // Hard assert the FK is present. If the client FK is ever dropped, this
    // fails loudly so the guard below is revisited rather than silently passing
    // against a dropped constraint.
    const fk = muscleGroupForeignKey(fixture);
    expect(fk).toBeDefined();
    expect(fk?.from).toBe('muscle_group_id');

    // Empty parent layer: `muscle_groups` is empty. The definition FK is
    // satisfied, so the ONLY thing that can fail is the muscle-group FK —
    // isolating it as the exact constraint the parent layer exists to satisfy.
    expect(muscleGroupCount(fixture)).toBe(0);
    const definitionId = 'pulled-def-2';
    insertPulledDefinition(fixture, definitionId);

    expect(() =>
      insertPulledMapping(fixture, {
        id: 'pulled-map-2',
        exerciseDefinitionId: definitionId,
        muscleGroupId: SYSTEM_MUSCLE_GROUP_SEEDS[0].id,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('is idempotent across repeated seeds and keeps the pulled-mapping FK satisfied', () => {
    seedMuscleGroupParents(fixture);
    seedMuscleGroupParents(fixture);

    // Re-seeding the parent layer neither duplicates rows nor drops any, so a
    // later pull still finds every referenced group present.
    expect(muscleGroupCount(fixture)).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);

    const definitionId = 'pulled-def-3';
    insertPulledDefinition(fixture, definitionId);
    expect(() =>
      insertPulledMapping(fixture, {
        id: 'pulled-map-3',
        exerciseDefinitionId: definitionId,
        muscleGroupId: SYSTEM_MUSCLE_GROUP_SEEDS[0].id,
      }),
    ).not.toThrow();
  });
});
