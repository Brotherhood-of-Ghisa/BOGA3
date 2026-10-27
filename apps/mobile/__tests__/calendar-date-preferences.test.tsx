import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { SessionShareCard } from '@/components/session-complete/session-share-sheet';
import { buildCompetitionRow, buildCompetitionPodiums } from '@/src/groups/competition-view-model';
import { buildCompetitionStreamItem } from '@/src/groups/competition-stream-view-model';
import { competitionBoard, competitionExercise, competitionRow, competitionStream } from './helpers/competition-fixtures';
import { __resetAccountLocalPreferencesForTests, initializeAccountLocalPreferences,
  ensureAccountLocalPreferencesLoaded, setAccountLocalPreferences } from '@/src/preferences/account-local';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatCalendarDate, formatCalendarWeek, formatCalendarWeekHeading, formatLocalDateTime, formatShortDate,
  parseSessionDateTime, reformatDateTime } from '@/src/utils/local-time';
import { formatSessionTimes, resolveSessionTimes } from '@/src/session-recorder/session-times';
import { resolveMeasurementDate } from '@/src/bodyweight/weight-entry';

const at = new Date(2026, 8, 17, 0, 30, 42, 123);
const formats = [
  ['DD-MM-YYYY', '17-09-2026'],
  ['MM-DD-YYYY', '09-17-2026'],
  ['YYYY-MM-DD', '2026-09-17'],
] as const;

test.each(formats)('%s reaches dates, clocks, group boards and the stream', (format, expected) => {
  expect(formatShortDate(at, format)).toBe(expected);
  expect(formatLocalDateTime(at.getTime(), format)).toBe(`${expected} 00:30`);
  expect(formatCalendarDate('2026-09-17', format)).toBe(expected);
  const row = { ...competitionRow, performance: { ...competitionRow.performance, achieved_at_ms: at.getTime() } };
  const board = buildCompetitionRow(row, 'all', 'me', format);
  expect(board.dateLabel).toBe(expected);
  expect(board.accessibilityLabel).toContain(expected);
  const podium = buildCompetitionPodiums({ contract_version: 4, certified: false,
    podiums: [{ exercise: competitionExercise, board: { ...competitionBoard, entries: [row] } }] }, 'me', format);
  expect(podium[0].rows[0].dateLabel).toBe(expected);
  const item = competitionStream.items[0];
  if (item.kind !== 'session') throw new Error('Expected a session fixture');
  expect(buildCompetitionStreamItem({ ...item, session: { ...item.session, started_at_ms: at.getTime() } }, format))
    .toMatchObject({ startedAtLabel: `${expected} 00:30` });
});

test.each(formats)('%s round-trips edits without changing stored seconds', (format, expected) => {
  expect(parseSessionDateTime(`${expected} 00:30`, format)).toEqual(new Date(2026, 8, 17, 0, 30));
  const persisted = { startedAt: at, completedAt: new Date(at.getTime() + 60_000) };
  expect(resolveSessionTimes(formatSessionTimes(persisted, format), persisted, format)).toEqual(persisted);
  expect(resolveMeasurementDate(`${expected} 00:30`, at, new Date(2027, 0, 1), format)).toBe(at);
  expect(reformatDateTime(`${expected} 00:30`, format, 'YYYY-MM-DD')).toBe('2026-09-17 00:30');
  expect(reformatDateTime('unfinished', format, 'YYYY-MM-DD')).toBe('unfinished');
});

test('ranges retain both years and calendar days over DST', () => {
  expect(formatCalendarWeek('2025-12-29', 'MM-DD-YYYY')).toBe('12-29-2025 – 01-04-2026');
  expect(formatCalendarWeek('2026-03-23', 'DD-MM-YYYY')).toBe('23-03-2026 – 29-03-2026');
  expect(formatCalendarWeek('2026-10-19', 'YYYY-MM-DD')).toBe('2026-10-19 – 2026-10-25');
  expect(parseSessionDateTime('29-03-2026 01:30', 'DD-MM-YYYY')).toBeNull();
  expect(parseSessionDateTime('02-30-2026 10:00', 'MM-DD-YYYY')).toBeNull();
  expect(parseSessionDateTime('2026-09-17 00:30', 'DD-MM-YYYY')).toBeNull();
  expect(formatShortDate(new Date(NaN), 'YYYY-MM-DD')).toBe('—');
  expect(formatLocalDateTime(NaN, 'MM-DD-YYYY')).toBe('—');
});

function DateProbe() {
  const format = useDateFormat();
  return <Text allowFontScaling={false} testID="preference-date">{formatLocalDateTime(at.getTime(), format)}</Text>;
}

// This is a formatting-only fixture: no repository read or write is performed.
const snapshot = { completedAt: at.toISOString(), durationDisplay: '1m', exerciseCount: 0,
  workingSetCount: 0, personalRecords: [], exerciseVolumeComparisons: [] };

test('mounted date consumers and the share image update through every setting', async () => {
  __resetAccountLocalPreferencesForTests();
  initializeAccountLocalPreferences(false);
  await ensureAccountLocalPreferencesLoaded();
  render(<View><DateProbe /><SessionShareCard snapshot={snapshot} /></View>);
  for (const [dateFormat, expected] of formats) {
    act(() => setAccountLocalPreferences({ dateFormat }));
    await waitFor(() => expect(screen.getByTestId('preference-date')).toHaveTextContent(`${expected} 00:30`));
    expect(screen.getByText(expected)).toBeTruthy();
  }
});

test('presentation lint rejects native dates, manual labels and fixed format arguments', () => {
  const script = `
    const { ESLint } = require('eslint');
    const source = [
      'const date = new Date();',
      'date.toLocaleDateString();',
      'date.toLocaleString();',
      'new Intl.DateTimeFormat("en-US");',
      'Intl.DateTimeFormat("en-US");',
      '\x60date: \x24{date.getDate()}\x60;',
      'formatShortDate(date, "MM-DD-YYYY");',
    ].join('\\n');
    new ESLint().lintText(source, { filePath: 'app/date-guardrail.tsx' })
      .then(([result]) => process.stdout.write(JSON.stringify(result.messages.filter(m => m.ruleId === 'no-restricted-syntax'))))
      .catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
  `;
  const messages = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  }));
  expect(messages).toHaveLength(6);
});


test.each([
  ['DD-MM-YYYY', '2026-10-19', '19–25 Oct 2026'],
  ['MM-DD-YYYY', '2026-10-19', 'Oct 19–25 2026'],
  ['YYYY-MM-DD', '2026-10-19', '2026 Oct 19–25'],
  ['DD-MM-YYYY', '2026-09-28', '28 Sep – 4 Oct 2026'],
  ['MM-DD-YYYY', '2026-09-28', 'Sep 28 – Oct 4 2026'],
  ['YYYY-MM-DD', '2026-09-28', '2026 Sep 28 – Oct 4'],
  ['DD-MM-YYYY', '2025-12-29', '29 Dec – 4 Jan 2026'],
  ['MM-DD-YYYY', '2025-12-29', 'Dec 29 – Jan 4 2026'],
  ['YYYY-MM-DD', '2025-12-29', '2026 Dec 29 – Jan 4'],
  ['DD-MM-YYYY', '2025-03-31', '31 Mar – 6 Apr 2025'],
  ['DD-MM-YYYY', '2025-02-03', '3–9 Feb 2025'],
  ['DD-MM-YYYY', '2026-03-23', '23–29 Mar 2026'],
] as const)('compact %s week heading uses only the end year and preserves local days (%s)', (format, key, expected) => {
  expect(formatCalendarWeekHeading(key, format)).toBe(expected);
});
