import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sessions } from './sessions';

// A member's link from one of their own sessions to a group meet (Sync v2
// entity, sync-v2 contract "Per-entity rules"). `meet_id` is plain text with no
// FK: meets are server-side group storage, not synced parents. The id is
// deterministic (`<meet_id>:<session_id>`), so leave tombstones the row and a
// re-join undeletes the same id. Whether a link counts is the server's rule
// (group-meet-contract "Roster and session links").
export const sessionMeetLinks = sqliteTable(
  'session_meet_links',
  {
    id: text('id').primaryKey().notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    meetId: text('meet_id').notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    localUpdatedAtMs: integer('local_updated_at_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    sessionIdx: index('session_meet_links_session_id_idx').on(table.sessionId),
    meetIdx: index('session_meet_links_meet_id_idx').on(table.meetId),
    deletedAtIdx: index('session_meet_links_deleted_at_idx').on(table.deletedAt),
    deterministicIdGuard: check(
      'session_meet_links_id_deterministic',
      sql`${table.id} = ${table.meetId} || ':' || ${table.sessionId}`
    ),
  })
);

export type SessionMeetLink = typeof sessionMeetLinks.$inferSelect;
export type NewSessionMeetLink = typeof sessionMeetLinks.$inferInsert;
