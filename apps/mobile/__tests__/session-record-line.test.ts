import {
  buildSessionRecordLine,
  GROUP_RECORD_NOUN,
  PERSONAL_RECORD_NOUN,
  sessionRecordLineText,
} from '@/src/session-insights/record-line';

// One PR names itself; more than one is only counted (today-landing.md).
describe('buildSessionRecordLine', () => {
  const describeRecord = (name: string) => `${name} 1RM 102.5`;

  it('has no line without records', () => {
    expect(buildSessionRecordLine([], describeRecord, PERSONAL_RECORD_NOUN)).toBeNull();
    expect(sessionRecordLineText(null)).toBeNull();
  });

  it('names a single record, then its noun', () => {
    const line = buildSessionRecordLine(['Bench Press'], describeRecord, PERSONAL_RECORD_NOUN);
    expect(line).toEqual({ kind: 'one', lead: 'Bench Press 1RM 102.5', note: 'PR' });
    expect(sessionRecordLineText(line)).toBe('Bench Press 1RM 102.5 · PR');
    expect(buildSessionRecordLine(['Deadlift'], describeRecord, GROUP_RECORD_NOUN))
      .toEqual({ kind: 'one', lead: 'Deadlift 1RM 102.5', note: 'group record' });
  });

  it('only counts several records, without describing any', () => {
    const describeSpy = jest.fn(describeRecord);
    expect(buildSessionRecordLine(['a', 'b', 'c'], describeSpy, PERSONAL_RECORD_NOUN)).toEqual({ kind: 'many', count: '3 PRs' });
    expect(describeSpy).not.toHaveBeenCalled();
    const group = buildSessionRecordLine(['a', 'b'], describeRecord, GROUP_RECORD_NOUN);
    expect(group).toEqual({ kind: 'many', count: '2 group records' });
    expect(sessionRecordLineText(group)).toBe('2 group records');
  });
});
