// SQL and device resolve the same private kg-only reading timeline. Called by
// groups-bodyweight inside its isolated owner fixture; every vector rolls back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createAsOfWeightResolver } from '../../apps/mobile/src/bodyweight/as-of.ts';

const [container, owner] = process.argv.slice(2);
assert.match(container, /^supabase_db_[\w-]+$/);
assert.match(owner, /^[0-9a-f-]{36}$/);

const row = (id, measuredAt, weightKg = 80) => ({ id, measuredAt, weightKg });
const vectors = [
  { name: 'no reading', rows: [], at: 2000, kg: null, id: null },
  { name: 'no prior reading', rows: [row('later', 2001)], at: 2000, kg: null, id: null },
  { name: 'exact instant', rows: [row('exact', 2000)], at: 2000, kg: 80, id: 'exact' },
  { name: 'latest prior', rows: [row('old', 1000), row('latest', 1999, 82), row('later', 2001, 90)],
    at: 2000, kg: 82, id: 'latest' },
  { name: 'binary tie', rows: [row('z', 1000, 90), row('a', 1000)], at: 2000, kg: 80, id: 'a' },
  { name: 'Unicode tie', rows: [row('\u{10000}', 1000, 90), row('\uE000', 1000)], at: 2000, kg: 80, id: '\uE000' },
  { name: 'tombstone', rows: [row('old', 1000), { ...row('deleted', 1999, 90), deletedAt: 2000 }],
    at: 2000, kg: 80, id: 'old' },
  { name: 'invalid latest is skipped', rows: [row('old', 1000), row('bad', 1999, 0)],
    at: 2000, kg: 80, id: 'old' },
  { name: 'blank Unicode ID', rows: [row('\u00a0', 1000)], at: 2000, kg: null, id: null },
  { name: 'mixed Unicode whitespace ID', rows: [row(' \u2009\t', 1000)], at: 2000, kg: null, id: null },
  { name: 'nonfinite kg', rows: [row('bad', 1000, Number.POSITIVE_INFINITY)], at: 2000, kg: null, id: null,
    sqlWeight: "'Infinity'::double precision" },
  { name: 'DST exact instants',
    rows: [row('before', +new Date('2026-10-25T01:15:00+01:00')), row('later', +new Date('2026-10-25T01:15:00Z'), 90)],
    at: +new Date('2026-10-25T01:30:00+01:00'), kg: 80, id: 'before' },
];
const quote = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;

for (const vector of vectors) {
  const derived = createAsOfWeightResolver(vector.rows)(vector.at);
  assert.equal(derived.bodyWeightKg, vector.kg, vector.name);
  assert.equal(derived.bodyWeightMeasurementId, vector.id, vector.name);
  const expected = {
    body_weight_kg: derived.bodyWeightKg,
    body_weight_source: derived.bodyWeightSource,
    body_weight_measurement_id: derived.bodyWeightMeasurementId,
    body_weight_measured_at: derived.bodyWeightMeasuredAt?.getTime() ?? null,
  };
  const inserts = vector.rows.map(reading => {
    const weight = Number.isFinite(reading.weightKg) ? quote(reading.weightKg) : vector.sqlWeight;
    return `insert into app_public.body_weight_measurements
      (owner_user_id,id,weight_kg,measured_at,deleted_at,created_at,updated_at,client_updated_at_ms)
      values (${[owner,reading.id].map(quote).join(',')},${weight},${[reading.measuredAt,reading.deletedAt,1,1,1]
        .map(quote).join(',')});`;
  }).join('\n');
  const sql = `begin; delete from app_public.body_weight_measurements where owner_user_id=${quote(owner)};
    ${inserts}
    select app_public.session_weight_as_of(${quote(owner)},${vector.at}); rollback;`;
  const result = execFileSync('docker', ['exec','-i',container,'psql','-U','postgres','-d','postgres',
    '-Atq','-v','ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result.trim()), expected, vector.name);
}

console.log(`[bodyweight-as-of] ${vectors.length} SQL/device parity vectors passed`);
