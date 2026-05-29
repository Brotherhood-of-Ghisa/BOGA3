// SQL is sourced from drizzle-kit's generated `drizzle/<tag>.sql` files
// and bundled into `drizzle/migrations.generated.ts` by
// `apps/mobile/scripts/bundle-migrations.ts`. Do NOT hand-edit either the
// bundle or the SQL files. Regenerate both with a single command:
//
//   npm --prefix apps/mobile run db:generate
//
// That script runs `drizzle-kit generate` to produce `drizzle/<tag>.sql`
// plus the journal at `drizzle/meta/_journal.json`, then runs
// `scripts/bundle-migrations.ts` to re-emit
// `drizzle/migrations.generated.ts` from those inputs. The runtime
// `localRuntimeMigrations` value below is the same shape Drizzle's Expo
// migrator expects (`MigrationConfig` from
// `drizzle-orm/expo-sqlite/migrator`) — see the bundle script for the
// per-entry key convention (`m${idx.padStart(4, '0')}`).

import type { migrate as migrateExpoSqlite } from 'drizzle-orm/expo-sqlite/migrator';

import { generatedMigrationBundle } from '../../../drizzle/migrations.generated';

type RuntimeMigrationConfig = Parameters<typeof migrateExpoSqlite>[1];

// The bundle's literal type is `as const` so it satisfies Drizzle's
// `MigrationConfig` shape positionally. We widen via an explicit cast to
// `RuntimeMigrationConfig` so call sites of
// `migrate(database, localRuntimeMigrations)` keep their existing
// signatures with no inference surprises.
export const localRuntimeMigrations: RuntimeMigrationConfig =
  generatedMigrationBundle as unknown as RuntimeMigrationConfig;
