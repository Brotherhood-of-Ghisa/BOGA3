import {
  buildSessionRecordLine,
  PERSONAL_RECORD_NOUN,
  sessionRecordLineText,
} from '@/src/session-insights/record-line';

// One PR names itself; more than one is only counted.
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
  });

  it('only counts several records, without describing any', () => {
    const describeSpy = jest.fn(describeRecord);
    expect(buildSessionRecordLine(['a', 'b', 'c'], describeSpy, PERSONAL_RECORD_NOUN)).toEqual({ kind: 'many', count: '3 PRs' });
    expect(describeSpy).not.toHaveBeenCalled();
    expect(sessionRecordLineText({ kind: 'many', count: '3 PRs' })).toBe('3 PRs');
  });
});
