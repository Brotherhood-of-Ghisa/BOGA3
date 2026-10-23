import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import { exerciseHistoryOpeningGym, historyBlockRecord } from '@/src/session-recorder/exercise-history-view';
import { cardRecordBand, recordFlagsFor } from '@/src/session-recorder/session-view-model';

describe('exerciseHistoryOpeningGym', () => {
  it('opens on the own book\'s gym of a split exercise, whatever the preference', () => {
    expect(exerciseHistoryOpeningGym({ ownBookGymId: 'gym-a', scope: 'all', currentGymId: 'gym-a' })).toBe('gym-a');
  });

  it('opens an unsplit exercise on the current gym only under Current gym only', () => {
    expect(exerciseHistoryOpeningGym({ ownBookGymId: null, scope: 'current-gym', currentGymId: 'gym-a' })).toBe('gym-a');
    expect(exerciseHistoryOpeningGym({ ownBookGymId: null, scope: 'all', currentGymId: 'gym-a' })).toBeUndefined();
  });

  it('opens on every gym for a session with no gym', () => {
    expect(exerciseHistoryOpeningGym({ ownBookGymId: null, scope: 'current-gym', currentGymId: null })).toBeUndefined();
  });
});

const entry = (records: ExerciseHistorySessionEntry['records']): ExerciseHistorySessionEntry => ({
  sessionId: 's1',
  sessionExerciseId: 'se1',
  completedAt: new Date('2026-05-12T16:00:00.000Z'),
  gymName: null,
  tagIds: [],
  bodyWeightKg: null,
  bodyWeightSource: null,
  bodyWeightMeasurementId: null,
  bodyWeightMeasuredAt: null,
  sets: [
    { setId: 'a', orderIndex: 0, weightValue: '120', repsValue: '2', setType: null, isWorking: true },
    { setId: 'b', orderIndex: 1, weightValue: '100', repsValue: '10', setType: null, isWorking: true },
  ],
  workingSetCount: 2,
  estimatedOneRepMax: 133.3,
  totalVolume: 1240,
  topWeightSet: { weight: 120, reps: 2 },
  records,
});

describe('historyBlockRecord', () => {
  it('is null without stored records', () => {
    expect(historyBlockRecord(entry(null))).toBeNull();
    expect(historyBlockRecord(entry(undefined))).toBeNull();
  });

  it('marks the 1RM and top-weight sets and reads the band View Session reads', () => {
    const record = historyBlockRecord(entry({
      oneRepMax: { setId: 'b', valueKg: 133.3 }, topWeightSetId: 'a', volumeKg: 1240,
    }));
    expect(recordFlagsFor(record, 'a')).toEqual({ oneRepMaxRecord: false, weightRecord: true });
    expect(recordFlagsFor(record, 'b')).toEqual({ oneRepMaxRecord: true, weightRecord: false });
    expect(cardRecordBand(record, 'se1').map((line) => [line.label, line.set])).toEqual([
      ['New 1RM record · 133.3', '100.0 × 10'],
      ['New top weight', '120.0 × 2'],
      ['New volume record · 1240', null],
    ]);
  });

  it('reads one line for a set that took both', () => {
    const record = historyBlockRecord(entry({ oneRepMax: { setId: 'a', valueKg: 128 }, topWeightSetId: 'a', volumeKg: null }));
    expect(recordFlagsFor(record, 'a')).toEqual({ oneRepMaxRecord: true, weightRecord: true });
    expect(cardRecordBand(record, 'se1').map((line) => line.label)).toEqual(['New 1RM · 128.0 + top weight']);
  });
});
