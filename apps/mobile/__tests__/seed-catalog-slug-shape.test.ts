/**
 * The bundled starter catalog uses deterministic `seed_*` slug primary keys so
 * bundle migrations, idempotent push retries, and cross-version references can
 * address a row by name. This file pins that slug contract:
 *
 *  - Every exercise-definition id is `seed_<snake_case_slug>`.
 *  - Every muscle-mapping id is `seed_map_<exercise-slug>__<muscle-slug>` and
 *    its exercise slug resolves back to a definition in the bundle while its
 *    muscle slug resolves to a bundled muscle group.
 *  - Muscle-group ids stay bare slugs (stable system-seeded ids — no lineage
 *    prefix).
 *  - No row carries the retired ownership-tier prefix.
 *
 * It also drives the real seeder against a fully-migrated in-memory database
 * and asserts its verification (row counts + mapping coverage) still passes
 * against the slugged bundle, so the data rename cannot silently break the
 * write path.
 */

import type { LocalDatabase } from '@/src/data/bootstrap';
import { __resetClockForTests } from '@/src/data/clock';
import {
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
  verifySeededSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

// `seed_` followed by a lowercase snake/kebab slug (digits and hyphens allowed
// inside the slug, e.g. `seed_low_cable_one-arm_lateral_raises`).
const EXERCISE_DEFINITION_SLUG = /^seed_[a-z0-9][a-z0-9_-]*$/;
// `seed_map_<exercise-slug>__<muscle-slug>` — the `__` separates the two slugs.
const MAPPING_SLUG = /^seed_map_[a-z0-9][a-z0-9_-]*__[a-z0-9][a-z0-9_-]*$/;
// Bare lowercase slug, no lineage prefix.
const MUSCLE_GROUP_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

const RETIRED_PREFIX = 'sys_';

describe('seeded catalog slug shape', () => {
  it('gives every exercise definition a seed_<slug> id with no retired prefix', () => {
    expect(SYSTEM_EXERCISE_DEFINITION_SEEDS.length).toBeGreaterThan(0);

    for (const exercise of SYSTEM_EXERCISE_DEFINITION_SEEDS) {
      expect(exercise.id).toMatch(EXERCISE_DEFINITION_SLUG);
      expect(exercise.id.startsWith(RETIRED_PREFIX)).toBe(false);
    }

    const ids = SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps muscle-group ids bare slugs with no lineage prefix', () => {
    expect(SYSTEM_MUSCLE_GROUP_SEEDS.length).toBeGreaterThan(0);

    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      expect(muscleGroup.id).toMatch(MUSCLE_GROUP_SLUG);
      expect(muscleGroup.id.startsWith('seed_')).toBe(false);
      expect(muscleGroup.id.startsWith(RETIRED_PREFIX)).toBe(false);
    }
  });

  it('gives every mapping a seed_map_<exercise>__<muscle> id referencing real bundle slugs', () => {
    expect(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length).toBeGreaterThan(0);

    const exerciseIds = new Set(SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id));
    const muscleIds = new Set(SYSTEM_MUSCLE_GROUP_SEEDS.map((muscleGroup) => muscleGroup.id));

    for (const mapping of SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS) {
      expect(mapping.id).toMatch(MAPPING_SLUG);
      expect(mapping.id.startsWith(RETIRED_PREFIX)).toBe(false);

      // The id's `<exercise>` segment is the definition slug with its `seed_`
      // prefix dropped; re-prefixing must land on a definition that exists in
      // the bundle, and the id's `<muscle>` segment must be the mapping's own
      // muscle group, which must be a bundled muscle group.
      const withoutPrefix = mapping.id.slice('seed_map_'.length);
      const separatorIndex = withoutPrefix.indexOf('__');
      const exerciseSlug = withoutPrefix.slice(0, separatorIndex);
      const muscleSlug = withoutPrefix.slice(separatorIndex + 2);

      expect(exerciseIds.has(`seed_${exerciseSlug}`)).toBe(true);
      expect(`seed_${exerciseSlug}`).toBe(mapping.exerciseDefinitionId);
      expect(muscleSlug).toBe(mapping.muscleGroupId);
      expect(muscleIds.has(muscleSlug)).toBe(true);

      // Referential integrity against the bundle, independent of the id string.
      expect(exerciseIds.has(mapping.exerciseDefinitionId)).toBe(true);
    }

    const mappingIds = SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.map((mapping) => mapping.id);
    expect(new Set(mappingIds).size).toBe(mappingIds.length);
  });

  describe('against the migrated database', () => {
    let fixture: InMemoryDatabaseFixture;

    beforeEach(() => {
      __resetClockForTests();
      fixture = createInMemoryDatabase({ foreignKeys: true });
    });

    afterEach(() => {
      fixture.close();
      __resetClockForTests();
    });

    it('seeds the slugged bundle and passes verification with unchanged counts and coverage', () => {
      // The seeder/verify helpers are typed against the production
      // expo-sqlite handle; the in-memory better-sqlite3 fixture is
      // structurally identical at runtime (see the fixture helper docs).
      const database = fixture.database as unknown as LocalDatabase;

      expect(() => seedSystemExerciseCatalog(database)).not.toThrow();

      const verification = verifySeededSystemExerciseCatalog(database);

      expect(verification.muscleGroupCount).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
      expect(verification.exerciseCount).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
      expect(verification.mappingCount).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);
      expect(verification.exercisesMissingMappings).toEqual([]);
      // Seeded rows ride the normal dirty contract so a fresh account pushes
      // its starter catalog on the next sync cycle.
      expect(verification.nonDirtyExerciseCount).toBe(0);
      expect(verification.nonDirtyMappingCount).toBe(0);
    });
  });
});
