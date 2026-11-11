/** A store workout becomes the server's upsert: type names, units, nulls, and loud failures. */
import { activityTypeName, HealthImportError, toImportedActivity } from '@/src/health-import/mapping';

import { healthWorkout } from './helpers/health-import-fakes';

describe('activityTypeName', () => {
  it.each([
    ['running', 'running'],
    ['traditionalStrengthTraining', 'traditional_strength_training'],
    ['highIntensityIntervalTraining', 'high_intensity_interval_training'],
    ['type84', 'type_84'],
  ])('maps %s to %s', (store, server) => {
    expect(activityTypeName(store)).toBe(server);
  });

  it('refuses a name the server would reject', () => {
    expect(() => activityTypeName('9lives')).toThrow(HealthImportError);
    expect(() => activityTypeName('')).toThrow('Unsupported workout type name');
  });
});

describe('toImportedActivity', () => {
  it('converts every summary figure to the server units', () => {
    expect(toImportedActivity(healthWorkout('w1'))).toEqual({
      external_id: 'w1', activity_type: 'running',
      started_at: '2026-11-09T07:00:00.000Z', ended_at: '2026-11-09T07:30:00.000Z',
      duration_sec: 1800, distance_m: 5012.3, active_energy_kcal: 351.2,
      avg_heart_rate_bpm: 148, max_heart_rate_bpm: 171, elevation_gain_m: 22,
      source_name: 'Workout', device_name: 'Apple Watch',
    });
  });

  it.each([
    [{ quantity: 5, unit: 'km' }, 5000],
    [{ quantity: 1, unit: 'mi' }, 1609.344],
    [{ quantity: 100, unit: 'ft' }, 30.48],
  ])('converts distance %o to metres', (distance, metres) => {
    expect(toImportedActivity(healthWorkout('w', { totalDistance: distance })).distance_m).toBeCloseTo(metres);
  });

  it('converts kilojoules to kilocalories', () => {
    expect(toImportedActivity(healthWorkout('w', { totalEnergyBurned: { quantity: 418.4, unit: 'kJ' } })).active_energy_kcal)
      .toBeCloseTo(100);
  });

  it('keeps unrecorded figures null and treats a zero heart rate as none', () => {
    const row = toImportedActivity(healthWorkout('w', {
      totalDistance: null, totalEnergyBurned: null, elevationAscended: null,
      averageHeartRateBpm: 0, maxHeartRateBpm: null, sourceName: '  ', deviceName: null,
    }));
    expect(row).toMatchObject({
      distance_m: null, active_energy_kcal: null, elevation_gain_m: null,
      avg_heart_rate_bpm: null, max_heart_rate_bpm: null, source_name: null, device_name: null,
    });
  });

  it('trims names and bounds them to the server limit', () => {
    expect(toImportedActivity(healthWorkout('w', { sourceName: `  ${'x'.repeat(250)} ` })).source_name).toHaveLength(200);
  });

  it('fails loud on a unit it does not know instead of guessing', () => {
    expect(() => toImportedActivity(healthWorkout('w', { totalDistance: { quantity: 3, unit: 'furlong' } })))
      .toThrow('Unsupported distance unit: furlong');
  });

  it('fails loud on a workout that ends before it starts', () => {
    expect(() => toImportedActivity(healthWorkout('w', { endDate: new Date('2026-11-09T06:00:00.000Z') })))
      .toThrow(expect.objectContaining({ code: 'INVALID_WORKOUT' }));
  });
});
