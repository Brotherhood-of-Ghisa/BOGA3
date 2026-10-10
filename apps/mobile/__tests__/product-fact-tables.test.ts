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
import { aggregateSelectedMuscleDailyEffort, aggregateSelectedMuscleDailyEffortMetrics,
  aggregateSelectedMuscleWeeklyEffort } from '@/src/data/muscle-analytics';
import { aggregateProgressComparisons } from '@/src/data/progress-comparisons';
import { aggregateStats } from '@/src/data/stats';
import { normalizeGroupSetFacts } from '@/src/groups/set-facts';
import { adaptCurrentSessionToMuscleAnalyticsInput, summarizeCurrentSessionMuscleLoad,
  type CurrentSessionMuscleSummaryInput, type SessionInsightMuscleMapping } from '@/src/session-insights';

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
  'muscle.set-count': [],
};

/** The facts whose tables this file runs, by subject file; every marker must be one. */
const HANDLED_IN: Record<string, string> = {
  'set.eligibility': 'set.md',
  '1rm.formula': '1rm.md',
  'muscle.set-count': 'muscle.md',
};
const HANDLED = Object.keys(HANDLED_IN);

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

describe('Pending: lines', () => {
  it('lists only cells the tables still have', () => {
    const listed = Object.entries(PENDING).flatMap(([id, cells]) => cells.map((cell) => `${id}|${cell}`));
    expect(listed.filter((cell) => !ranCells.has(cell))).toEqual([]);
  });

  it.each(Object.entries(HANDLED_IN).map(([id, file]) => [file, id]))(
    '%s keeps a Pending: line for %s exactly while it has pending cells',
    (file, id) => {
      expect(readFactTable(file, id).pending).toBe(PENDING[id].length > 0);
    },
  );
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

  const AT = new Date('2026-10-09T18:00:00.000Z');
  // The fact applies on every screen that shows sets per muscle, so a row is
  // only satisfied when all of them agree. One exercise definition per set, so
  // a set's roles are its own: each surface takes the strongest role a set
  // holds for the muscle, not the strongest in the session.
  const sessionFor = (sets: ('primary' | 'secondary' | 'stabilizer')[][]): CurrentSessionMuscleSummaryInput => ({
    sessionId: 'session',
    sessionAt: AT,
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
    muscleMappings: sets.flatMap((roles, index) =>
      roles.map((role): SessionInsightMuscleMapping =>
        ({ exerciseDefinitionId: `def-${index}`, muscleGroupId: 'chest', role }))),
    muscleGroups: [{ id: 'chest', displayName: 'Chest', familyName: 'Upper', sortOrder: 1 }],
  });

  /** What each surface reports for the muscle. A muscle that gets nothing is absent, which is zero. */
  const figuresFor = (sets: ('primary' | 'secondary' | 'stabilizer')[][]): Record<string, number> => {
    const summary = summarizeCurrentSessionMuscleLoad(sessionFor(sets));
    const input = adaptCurrentSessionToMuscleAnalyticsInput(sessionFor(sets));
    const periods = { current: { start: new Date(AT.getTime() - 1), end: new Date(AT.getTime() + 1) },
      previous: { start: new Date(AT.getTime() - 3), end: new Date(AT.getTime() - 1) } };
    const daily = aggregateSelectedMuscleDailyEffort(input, { muscleGroupIds: ['chest'], timeZone: 'UTC' });
    const chest = (rows: { muscleGroupId: string }[], read: (row: never) => number) => {
      const row = rows.find((candidate) => candidate.muscleGroupId === 'chest');
      return row === undefined ? 0 : read(row as never);
    };
    return {
      'session summary': summary.workingSetsByMuscle.find((muscle) => muscle.id === 'chest')?.weightedSetCount ?? 0,
      'session summary load': summary.muscles.find((muscle) => muscle.id === 'chest')?.workingSetCount ?? 0,
      progress: chest(aggregateProgressComparisons(input, periods),
        (row: { current: { workingSetCount: number } }) => row.current.workingSetCount),
      stats: chest(aggregateStats(input).muscleFamilies.flatMap((family) => family.muscles),
        (row: { workingSetCount: number }) => row.workingSetCount),
      'heatmap day': aggregateSelectedMuscleDailyEffortMetrics(daily)[0]?.workingSetCount ?? 0,
      'heatmap week': aggregateSelectedMuscleWeeklyEffort(daily)[0]?.workingSetCount ?? 0,
      'heatmap target': aggregateSelectedMuscleDailyEffortMetrics(daily)[0]?.workingSetCountsByMuscle?.chest ?? 0,
    };
  };

  for (const row of table.rows) {
    runCell('muscle.set-count', row[KEY], COLUMN, () => {
      const want = Number(row[COLUMN]);
      const figures = figuresFor(ROLES[row[KEY]]);
      return {
        actual: figures,
        want: Object.fromEntries(Object.keys(figures).map((surface) => [surface, want])),
      };
    });
  }
});
