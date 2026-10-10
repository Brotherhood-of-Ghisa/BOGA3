/**
 * Product fact tables run against the real code (`docs/product/README.md`,
 * "Executable tables"). Every row of a table marked
 * `<!-- fact-table: <id> -->` is a test, so a fact and the code cannot drift.
 *
 * A cell the fact's `Pending:` line explains is listed in PENDING and runs as
 * `test.failing`. Implementing the decision makes that cell pass, which fails
 * here until the cell leaves PENDING; the last one leaving fails the
 * `Pending:` test until the fact drops the line. A pending cell also runs a
 * plain test that it can be evaluated, so a typo or a crash is never mistaken
 * for the expected mismatch.
 */

import fs from 'node:fs';
import path from 'node:path';

import { estimateOneRepMax } from '@/src/exercise-calculations';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '@/src/exercise-calculations/effort-policy';
import { formatOneRepMax } from '@/src/exercise-calculations/format';
import { isVolumeSet, isWorkingSet } from '@/src/exercise-calculations/set-semantics';
import { normalizeGroupSetFacts } from '@/src/groups/set-facts';
import { summarizeCurrentSessionMuscleLoad, type SessionInsightMuscleMapping } from '@/src/session-insights';
import { formatEmptyWeeks, groupSessionsByWeek, historyWeekHeading } from '@/components/session-list/history-weeks';
import type { SessionListItem } from '@/components/session-list/types';

const PRODUCT_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'product');

type FactRow = Record<string, string>;
type FactTable = { columns: string[]; rows: FactRow[]; pending: boolean };

const splitRow = (line: string): string[] =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

/** The marked table of fact `id` in `file`, and whether the fact has a `Pending:` line. */
const readFactTable = (file: string, id: string): FactTable => {
  const source = fs.readFileSync(path.join(PRODUCT_DIR, file), 'utf8');
  const start = source.indexOf(`### ${id} · `);
  const end = source.indexOf('\n### ', start + 1);
  const section = source.slice(start, end === -1 ? undefined : end);
  const marker = section.indexOf(`<!-- fact-table: ${id} -->`);
  if (start === -1 || marker === -1) throw new Error(`${file}: no fact-table marker for ${id}`);
  const lines = section.slice(marker).split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  const after = lines.findIndex((line, index) => index > first && !line.startsWith('|'));
  const [columns, , ...body] = lines.slice(first, after === -1 ? undefined : after).map(splitRow);
  return {
    columns,
    rows: body.map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index]]))),
    pending: /^Pending: /m.test(section),
  };
};

/** Cells that disagree with code until a fact's `Pending:` decision ships: `<row key>|<column>`. */
const PENDING: Record<string, readonly string[]> = {
  'set.eligibility': [],
  '1rm.formula': [],
  'session.history-weeks': [],
  'muscle.set-count': [],
};

/** The facts whose tables this file runs; every fact-table marker must be one. */
const HANDLED = ['set.eligibility', '1rm.formula', 'session.history-weeks', 'muscle.set-count'];

const ranCells = new Set<string>();

type CellResult = { actual: unknown; want: unknown };

const runCell = (id: string, key: string, column: string, evaluate: () => CellResult) => {
  const name = `${key} → ${column}`;
  const check = () => {
    const { actual, want } = evaluate();
    expect(actual).toEqual(want);
  };
  ranCells.add(`${id}|${key}|${column}`);
  if (!PENDING[id].includes(`${key}|${column}`)) {
    test(name, check);
    return;
  }
  test(`${name} (Pending) evaluates`, () => {
    expect(evaluate).not.toThrow();
  });
  test.failing(`${name} (Pending)`, check);
};

it('runs every fact table in docs/product/', () => {
  const marked = fs.readdirSync(PRODUCT_DIR)
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) => [...fs.readFileSync(path.join(PRODUCT_DIR, file), 'utf8')
      .matchAll(/<!-- fact-table: ([^\s<>]+) -->/g)].map((match) => match[1]));
  expect(marked.sort()).toEqual([...HANDLED].sort());
});

describe('set.eligibility', () => {
  const table = readFactTable('set.md', 'set.eligibility');
  const LABEL = 'Effort label';
  // The stored efforts each row's label stands for.
  const STORED_EFFORTS: Record<string, readonly (string | null)[]> = {
    'Warm-up': ['warm_up'],
    'Unspecified (no label)': [null, 'unspecified'],
    'RIR 4, 3, 2, 1, 0': ['rir_4', 'rir_3', 'rir_2', 'rir_1', 'rir_0'],
    'Stored RIR above 4': ['rir_5', 'rir_12'],
    Technique: ['technique'],
    Cooldown: ['cooldown'],
    'Unknown stored label': ['drop_set'],
  };
  const performed = { weight: '100', reps: '5', performanceStatus: null };
  const groupWorking = (setType: string | null): boolean => {
    const [fact] = normalizeGroupSetFacts({
      session_id: 'session',
      started_at_ms: 1,
      sets: [{
        set_id: 'set',
        session_exercise_id: 'exercise',
        exercise_definition_id: null,
        exercise_order_index: 0,
        set_order_index: 0,
        set_type: setType,
        weight_value: performed.weight,
        reps_value: performed.reps,
        performance_status: null,
        live: false,
        fingerprint: 'fingerprint',
      }],
    });
    if (fact === undefined) throw new Error('no group set fact');
    return fact.performed && fact.working;
  };
  const COLUMNS: Record<string, (setType: string | null) => boolean> = {
    'Personal working set (default)': (setType) =>
      isWorkingSet({ ...performed, setType }, DEFAULT_PERSONAL_EFFORT_POLICY),
    'Personal volume-included (default)': (setType) =>
      isVolumeSet({ ...performed, setType }, DEFAULT_PERSONAL_EFFORT_POLICY),
    'Groups and coaching (fixed)': groupWorking,
  };

  /** `yes`/`no`, or `as <label>`: that row's cell in the same column. */
  const expected = (cell: string, column: string): boolean => {
    if (cell === 'yes' || cell === 'no') return cell === 'yes';
    const target = table.rows.find((row) => row[LABEL].startsWith(cell.replace(/^as /, '')));
    if (!cell.startsWith('as ') || !target) throw new Error(`unreadable cell '${cell}'`);
    return expected(target[column], column);
  };

  it('maps every row and column to code', () => {
    expect(table.rows.map((row) => row[LABEL])).toEqual(Object.keys(STORED_EFFORTS));
    expect(table.columns).toEqual([LABEL, ...Object.keys(COLUMNS)]);
  });

  for (const row of table.rows) {
    for (const column of Object.keys(COLUMNS)) {
      runCell('set.eligibility', row[LABEL], column, () => {
        const want = expected(row[column], column);
        const efforts = STORED_EFFORTS[row[LABEL]] ?? [];
        return {
          actual: efforts.map((setType) => ({ setType, counts: COLUMNS[column](setType) })),
          want: efforts.map((setType) => ({ setType, counts: want })),
        };
      });
    }
  }
});

describe('1rm.formula', () => {
  const table = readFactTable('1rm.md', '1rm.formula');

  it('has the load, reps and shown columns, and rows', () => {
    expect(table.columns).toEqual(['Load kg', 'Reps', '1RM shown']);
    expect(table.rows.length).toBeGreaterThan(0);
  });

  for (const row of table.rows) {
    runCell('1rm.formula', `${row['Load kg']} × ${row.Reps}`, '1RM shown', () => {
      const oneRepMax = estimateOneRepMax(Number(row['Load kg']), Number(row.Reps));
      return { actual: oneRepMax === null ? null : formatOneRepMax(oneRepMax), want: row['1RM shown'] };
    });
  }
});

describe('session.history-weeks', () => {
  const table = readFactTable('session.md', 'session.history-weeks');
  const NOW = new Date(2026, 9, 8, 12);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** `Wed 7 Oct`, `Mon 5 Oct 00:00`, `Wed 31 Dec 2025`, `Mon 5 Oct deleted`, `… no working set`: one completed session. */
  const session = (entry: string, index: number): SessionListItem => {
    const match = /^\w{3} (\d{1,2}) (\w{3})(?: (\d{4}))?(?: (\d{2}):(\d{2}))?( deleted)?( no working set)?$/.exec(entry);
    if (!match) throw new Error(`unreadable session '${entry}'`);
    const [, day, month, year, hours, minutes, deleted, noWorkingSet] = match;
    const completedAt = new Date(Number(year ?? 2026), MONTHS.indexOf(month), Number(day), Number(hours ?? 18), Number(minutes ?? 0));
    if (!entry.startsWith(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][completedAt.getDay()])) {
      throw new Error(`'${entry}' names the wrong weekday`);
    }
    return {
      id: `session-${index}`,
      startedAt: completedAt.toISOString(),
      status: 'completed',
      completedAt: completedAt.toISOString(),
      durationSec: 3_600,
      durationDisplay: '1h',
      gymName: null,
      exerciseCount: 1,
      setCount: noWorkingSet ? 0 : 3,
      totalWeight: 0,
      deletedAt: deleted ? completedAt.toISOString() : null,
      records: [],
    };
  };

  it('has the sessions and shown columns, and rows', () => {
    expect(table.columns).toEqual(['Sessions completed', 'Shown']);
    expect(table.rows.length).toBeGreaterThan(0);
  });

  for (const row of table.rows) {
    runCell('session.history-weeks', row['Sessions completed'], 'Shown', () => {
      const sessions = row['Sessions completed'].split(', ').map(session);
      const lines = groupSessionsByWeek(sessions, NOW).flatMap((section) => {
        const heading = historyWeekHeading(section, NOW);
        const gap = section.emptyWeeksBefore > 0 ? [formatEmptyWeeks(section.emptyWeeksBefore)] : [];
        return [...gap, `${heading.title} · ${heading.detail}`];
      });
      return { actual: lines.join(' / '), want: row.Shown };
    });
  }
});

describe('Pending: lines', () => {
  it('lists only cells the tables still have', () => {
    const listed = Object.entries(PENDING).flatMap(([id, cells]) => cells.map((cell) => `${id}|${cell}`));
    expect(listed.filter((cell) => !ranCells.has(cell))).toEqual([]);
  });

  it.each([
    ['set.md', HANDLED[0]],
    ['1rm.md', HANDLED[1]],
    ['session.md', HANDLED[2]],
  ])('%s keeps a Pending: line for %s exactly while it has pending cells', (file, id) => {
    expect(readFactTable(file, id).pending).toBe(PENDING[id].length > 0);
  });
});

describe('muscle.set-count', () => {
  const table = readFactTable('muscle.md', 'muscle.set-count');
  const KEY = 'Working sets mapped to one muscle';
  const COLUMN = 'It gets';

  // Each row as the roles its sets map to the one muscle under test. A row
  // naming two roles for one set maps that set twice.
  const ROLES: Record<string, ('primary' | 'secondary' | 'stabilizer')[][]> = {
    '3 primary': [['primary'], ['primary'], ['primary']],
    '3 secondary': [['secondary'], ['secondary'], ['secondary']],
    '2 primary, 3 secondary': [
      ['primary'], ['primary'], ['secondary'], ['secondary'], ['secondary'],
    ],
    '1 set, primary and secondary to that muscle': [['primary', 'secondary']],
    '4 stabilizer': [['stabilizer'], ['stabilizer'], ['stabilizer'], ['stabilizer']],
  };

  // One exercise definition per set, so a set's roles are its own: the summary
  // takes the strongest role a set holds for a muscle, not the strongest in
  // the session.
  const weightedSetCountFor = (sets: ('primary' | 'secondary' | 'stabilizer')[][]): number => {
    const muscleMappings: SessionInsightMuscleMapping[] = sets.flatMap((roles, index) =>
      roles.map((role) => ({ exerciseDefinitionId: `def-${index}`, muscleGroupId: 'chest', role }))
    );
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 'session',
      sessionAt: new Date('2026-10-09T18:00:00.000Z'),
      exercises: sets.map((_roles, index) => ({
        id: `ex-${index}`,
        orderIndex: index,
        exerciseDefinitionId: `def-${index}`,
        exerciseName: `Exercise ${index}`,
        sets: [{ id: `set-${index}`, orderIndex: 0, weightValue: '100', repsValue: '5', setType: 'rir_1' }],
      })),
      exerciseDefinitions: sets.map((_roles, index) => ({
        id: `def-${index}`,
        loadInputMode: 'total_load' as const,
        bodyweightContribution: 0,
      })),
      muscleMappings,
      muscleGroups: [{ id: 'chest', displayName: 'Chest', familyName: 'Upper', sortOrder: 1 }],
    });
    // A muscle that gets nothing is absent from the table, which is zero sets.
    return summary.workingSetsByMuscle.find((muscle) => muscle.id === 'chest')?.weightedSetCount ?? 0;
  };

  for (const row of table.rows) {
    runCell('muscle.set-count', row[KEY], COLUMN, () => ({
      actual: weightedSetCountFor(ROLES[row[KEY]]),
      want: Number(row[COLUMN]),
    }));
  }
});
