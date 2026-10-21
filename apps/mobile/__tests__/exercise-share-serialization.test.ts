import {
  decodeExerciseSharePayload,
  encodeExerciseSharePayload,
  buildExerciseShareLink,
  buildExerciseShareMessage,
  type ExerciseSharePayload,
} from '@/src/exercise-share';

describe('exercise-share serialization & link builders', () => {
  const samplePayload: ExerciseSharePayload = {
    v: 1,
    name: 'Incline Dumbbell Press',
    loadInputMode: 'per_side_load',
    bodyweightContribution: 0.25,
    mappings: [
      { muscleGroupId: 'chest', weight: 0.7, role: 'primary' },
      { muscleGroupId: 'triceps', weight: 0.3, role: 'secondary' },
    ],
  };

  it('round-trips a valid exercise share payload', () => {
    const encoded = encodeExerciseSharePayload(samplePayload);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    // Base64url characters only
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const decoded = decodeExerciseSharePayload(encoded);
    expect(decoded).toEqual(samplePayload);
  });

  it('preserves non-ASCII unicode characters in exercise names', () => {
    const unicodePayload: ExerciseSharePayload = {
      v: 1,
      name: 'Élévation latérale & squat sauté 🏋️',
      loadInputMode: 'total_load',
      bodyweightContribution: 0,
      mappings: [{ muscleGroupId: 'shoulders', weight: 1, role: 'primary' }],
    };
    const encoded = encodeExerciseSharePayload(unicodePayload);
    const decoded = decodeExerciseSharePayload(encoded);
    expect(decoded).toEqual(unicodePayload);
  });

  it('returns null on invalid payloads', () => {
    expect(decodeExerciseSharePayload('')).toBeNull();
    expect(decodeExerciseSharePayload('not-valid-base64url!!!')).toBeNull();

    // Invalid version
    const invalidVersion = { ...samplePayload, v: 2 };
    expect(decodeExerciseSharePayload(encodeExerciseSharePayload(invalidVersion as any))).toBeNull();

    // Missing / empty name
    const missingName = { ...samplePayload, name: '   ' };
    expect(decodeExerciseSharePayload(encodeExerciseSharePayload(missingName))).toBeNull();

    // Invalid load mode
    const invalidLoadMode = { ...samplePayload, loadInputMode: 'invalid_mode' };
    expect(decodeExerciseSharePayload(encodeExerciseSharePayload(invalidLoadMode as any))).toBeNull();

    // Invalid bodyweight contribution (> 1 or < 0)
    const invalidBw = { ...samplePayload, bodyweightContribution: 1.5 };
    expect(decodeExerciseSharePayload(encodeExerciseSharePayload(invalidBw))).toBeNull();

    // Invalid mappings (negative weight or empty id)
    const invalidMapping = { ...samplePayload, mappings: [{ muscleGroupId: '', weight: 0.5 }] };
    expect(decodeExerciseSharePayload(encodeExerciseSharePayload(invalidMapping as any))).toBeNull();
  });

  it('builds a deep link with scheme boga3://exercise-share', () => {
    const link = buildExerciseShareLink('group-123', samplePayload);
    expect(link).toContain('boga3://exercise-share?groupId=group-123&payload=');

    const url = new URL(link);
    expect(url.protocol).toBe('boga3:');
    expect(url.host).toBe('exercise-share');
    expect(url.searchParams.get('groupId')).toBe('group-123');

    const payloadParam = url.searchParams.get('payload');
    expect(payloadParam).toBeTruthy();
    expect(decodeExerciseSharePayload(payloadParam!)).toEqual(samplePayload);
  });

  it('builds a human-friendly share message', () => {
    const link = buildExerciseShareLink('group-123', samplePayload);
    const message = buildExerciseShareMessage('Garage Gym', samplePayload.name, link);

    expect(message).toContain('Check out the exercise "Incline Dumbbell Press"');
    expect(message).toContain('shared with "Garage Gym" on BOGA.');
    expect(message).toContain(link);
  });
});
