/**
 * FK integrity of the boot-time data-layer seed.
 *
 * This is the infra-free regression guard for the bug class that PR #155 fixed
 * the hard way: the sync re-pull inserts `exercise_muscle_mappings` rows whose
 * `muscle_group_id` is a NOT NULL local FK into `muscle_groups` — a client-only
 * taxonomy that never crosses the sync wire. Production avoids an FK violation
 * because boot ALWAYS seeds `muscle_groups` first, via `seedBootDataLayer`,
 * before any pull touches the database (see `src/data/bootstrap.ts`). The
 * existing bootstrap suite (`local-data-bootstrap.test.ts`) mocks that seed to a
 * `jest.fn()` and the DB to a plain object, so it proves the seed is *called* in
 * the right order but never proves it produces rows that actually satisfy the
 * FK. The live cycle-round-trip test proves it end to end, but only in the
 * live-endpoint infra lane that the fast lane excludes.
 *
 * This test closes that gap in the fast lane: it runs the REAL `seedBootDataLayer`
 * against a real, fully-migrated in-memory `better-sqlite3` database with
 * `PRAGMA foreign_keys = ON` (the same enforcement the production expo-sqlite
 * handle ships), then exercises the exact production sync-configured path — a
 * pulled mapping referencing a *seeded* muscle group and a *pulled* exercise
 * definition — and asserts it inserts cleanly. The negative control proves the
 * boot seed is load-bearing: with the FK enforced and `muscle_groups` empty, the
 * same insert fails. If `fix/drop-client-muscle-group-fk` ever lands, the
 * hard-asserted FK-present check below is meant to fail loudly so this guard is
 * revisited deliberately rather than silently passing against a dropped FK.
 */

import {
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
import { seedBootDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  muscleGroups,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

// `seedBootDataLayer` is typed against the production expo-sqlite handle; the
// in-memory better-sqlite3 handle is structurally identical (both extend the
// same drizzle sync base), so this cast is a type-only bridge — the same one
// `muscle-group-bootstrap-idempotent.test.ts` uses.
const bootSeed = (fixture: InMemoryDatabaseFixture): void =>
  seedBootDataLayer(fixture.database as unknown as LocalDatabase);

const muscleGroupCount = (fixture: InMemoryDatabaseFixture): number =>
  fixture.database.select().from(muscleGroups).all().length;

// A pulled exercise definition (in a sync-configured build the catalog is NOT
// seeded at boot — only `muscle_groups` is — so the definition arrives via the
// pull leg, exactly like this).
const insertPulledDefinition = (fixture: InMemoryDatabaseFixture, id: string): void => {
  fixture.database.insert(exerciseDefinitions).values({ id, name: 'Bench Press' }).run();
};

// The pulled mapping itself: references a (pulled) definition and a
// (boot-seeded) muscle group.
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
// if the client-only FK is ever dropped, rather than silently passing.
const muscleGroupForeignKey = (
  fixture: InMemoryDatabaseFixture,
): { table: string; from: string; to: string } | undefined =>
  (
    fixture.client.pragma(
      "foreign_key_list('exercise_muscle_mappings')",
    ) as { table: string; from: string; to: string }[]
  ).find((fk) => fk.table === 'muscle_groups');

describe('boot-seed FK integrity (muscle_groups satisfies the pulled-mapping FK)', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    // FK enforcement ON — the same as the production expo-sqlite handle, and the
    // whole point of this suite. Without it the negative control could not fail.
    fixture = createInMemoryDatabase({ foreignKeys: true });
  });

  afterEach(() => {
    fixture.close();
  });

  it('populates the client-only muscle_groups taxonomy via the production boot path', () => {
    expect(muscleGroupCount(fixture)).toBe(0);

    bootSeed(fixture);

    // `seedBootDataLayer` is the exact entry production runs at boot; assert it
    // seeds the full bundle (covers the helper itself, not just its callee).
    expect(muscleGroupCount(fixture)).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
  });

  it('lets a pulled mapping referencing a seeded muscle group insert cleanly under an enforced FK', () => {
    bootSeed(fixture);

    const definitionId = 'pulled-def-1';
    insertPulledDefinition(fixture, definitionId);

    // The mapping points at a muscle group that the boot seed created — the
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

  it('fails the pulled-mapping insert when the boot seed is skipped (the seed is load-bearing)', () => {
    // Hard assert the FK is present. If `fix/drop-client-muscle-group-fk` lands
    // and removes it, this fails loudly so the guard below is revisited rather
    // than silently passing against a dropped constraint.
    const fk = muscleGroupForeignKey(fixture);
    expect(fk).toBeDefined();
    expect(fk?.from).toBe('muscle_group_id');

    // No boot seed: `muscle_groups` is empty. The definition FK is satisfied, so
    // the ONLY thing that can fail is the muscle-group FK — isolating it as the
    // exact constraint the boot seed exists to satisfy.
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

  it('is idempotent across repeated boots and keeps the pulled-mapping FK satisfied', () => {
    bootSeed(fixture);
    bootSeed(fixture);

    // Re-running the boot seed neither duplicates rows nor drops any, so a later
    // pull still finds every referenced group present.
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
