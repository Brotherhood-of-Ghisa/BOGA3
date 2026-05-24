import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const gyms = sqliteTable(
  'gyms',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .default(sql`(lower(hex(randomblob(16))))`),
    name: text('name').notNull(),
    latitude: real('latitude'),
    longitude: real('longitude'),
    coordinateAccuracyM: real('coordinate_accuracy_m'),
    coordinatesUpdatedAt: integer('coordinates_updated_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    nameLookupIdx: index('gyms_name_idx').on(table.name),
    latitudeRange: check('gyms_latitude_range', sql`${table.latitude} is null or (${table.latitude} >= -90 and ${table.latitude} <= 90)`),
    longitudeRange: check(
      'gyms_longitude_range',
      sql`${table.longitude} is null or (${table.longitude} >= -180 and ${table.longitude} <= 180)`
    ),
    coordinateAccuracyNonNegative: check(
      'gyms_coordinate_accuracy_non_negative',
      sql`${table.coordinateAccuracyM} is null or ${table.coordinateAccuracyM} >= 0`
    ),
    coordinatesUpdatedAtNonNegative: check(
      'gyms_coordinates_updated_at_non_negative',
      sql`${table.coordinatesUpdatedAt} is null or ${table.coordinatesUpdatedAt} >= 0`
    ),
    coordinateShape: check(
      'gyms_coordinate_shape',
      sql`(
        ${table.latitude} is null
        and ${table.longitude} is null
        and ${table.coordinateAccuracyM} is null
        and ${table.coordinatesUpdatedAt} is null
      ) or (
        ${table.latitude} is not null
        and ${table.longitude} is not null
        and ${table.coordinateAccuracyM} is not null
        and ${table.coordinatesUpdatedAt} is not null
      )`
    ),
  })
);

export type Gym = typeof gyms.$inferSelect;
export type NewGym = typeof gyms.$inferInsert;
