// Per-call page budgets for the read-path scenario set, and the checks that
// make that set strict. Pure: the runner hands it measurements per RPC per
// history point; it decides pass, fail or warn and formats the table.
//
// Pages are shared buffer pages (hit + read) of one call, measured as
// PostgREST runs it on the read-path fixture (M members, H days). A budget is
// the costliest measured call at any history point plus about 25% headroom.

import { perDoubling } from './report.ts';

/** The page ceiling every budgeted entry stays under, unless it says why not. */
export const PAGE_CEILING = 5000;
/** The most a budgeted week- or period-scoped RPC may grow per doubling of history. */
export const SLOPE_LIMIT = 1.2;
/** Below this many pages per call a few pages of noise move the slope, so it is not checked. */
export const SLOPE_MIN_PAGES = 100;
/** Headroom a budget adds over the measured cost. */
export const BUDGET_HEADROOM = 1.25;

/**
 * `budgeted`: at or under the ceiling unless `justification` says why not; a
 * scoped entry's slope is asserted. `baseline` (a recorded cost with no
 * ceiling or slope held) is refused: every entry the set measures must be
 * `budgeted`, so every RPC is held to the ceiling.
 */
export type BudgetKind = 'baseline' | 'budgeted';

export type BudgetEntry = {
  kind: BudgetKind;
  /** Most pages one call may touch, at every measured point. */
  pages: number;
  /** Week-, period-, page- or single-item-scoped: its cost should not grow with history. */
  scoped: boolean;
  /** Why a budgeted entry sits over the ceiling, in product or engineering terms. */
  justification?: string;
};

/** One RPC's measured cost at one history point. */
export type PointCost = {
  historyDays: number;
  /** Calls measured; the cost is the most expensive one. */
  calls: number;
  pages: number;
  tempBytes: number;
  seqScans: number;
  /** A failed call's SQLSTATE, or a reason it was not measured. */
  error: string | null;
};

export type CheckLevel = 'pass' | 'fail';
export type BudgetCheck = { fn: string; level: CheckLevel; message: string };

/**
 * A budget for a measured cost: ~25% headroom, rounded up to two significant
 * figures; a small cost gets at least 10 pages, since pages move by a few
 * run to run.
 */
export const suggestBudget = (pages: number): number => {
  const raw = Math.ceil(pages * BUDGET_HEADROOM);
  if (raw < 100) return Math.max(10, Math.ceil(Math.max(raw, pages + 10) / 10) * 10);
  const step = 10 ** (Math.floor(Math.log10(raw)) - 1);
  return Math.ceil(raw / step) * step;
};

/** Growth per doubling of history between the two smallest and largest measured points, or null. */
export const historySlope = (points: readonly PointCost[]): number | null => {
  const usable = points.filter((point) => point.error === null && point.calls > 0).sort((a, b) => a.historyDays - b.historyDays);
  if (usable.length < 2) return null;
  const [first, last] = [usable[0], usable[usable.length - 1]];
  return perDoubling(first.historyDays, first.pages, last.historyDays, last.pages);
};

const fmtSlope = (slope: number | null) => (slope === null ? '—' : `${slope.toFixed(2)}×`);

/**
 * Every check for one RPC: its entry is `budgeted`, it was measured at every
 * point without failing, no call exceeded its budget, an entry over the
 * ceiling says why, and a scoped entry over SLOPE_MIN_PAGES grows at most
 * SLOPE_LIMIT per doubling.
 */
export const checkBudget = (fn: string, entry: BudgetEntry | undefined, points: readonly PointCost[]): BudgetCheck[] => {
  if (!entry) return [{ fn, level: 'fail', message: 'measured but has no budget entry' }];
  const checks: BudgetCheck[] = [];
  if (entry.kind !== 'budgeted') {
    checks.push({ fn, level: 'fail', message: `a \`${entry.kind}\` entry is refused: measure it and make it \`budgeted\`` });
  }
  if (entry.pages > PAGE_CEILING && !entry.justification?.trim()) {
    checks.push({ fn, level: 'fail', message: `budget ${entry.pages} pages is over the ${PAGE_CEILING}-page ceiling without a justification` });
  }
  if (points.length === 0) checks.push({ fn, level: 'fail', message: 'not measured' });
  for (const point of points) {
    if (point.error !== null || point.calls === 0) {
      checks.push({ fn, level: 'fail', message: `H=${point.historyDays}: ${point.error ?? 'no call measured'}` });
    } else if (point.pages > entry.pages) {
      checks.push({ fn, level: 'fail', message: `H=${point.historyDays}: ${point.pages} pages per call, over its budget of ${entry.pages}` });
    }
  }
  const slope = historySlope(points);
  const largest = Math.max(0, ...points.map((point) => point.pages));
  if (entry.scoped && slope !== null && slope > SLOPE_LIMIT && largest > SLOPE_MIN_PAGES) {
    checks.push({ fn, level: 'fail', message: `grows ${fmtSlope(slope)} per doubling of history, over ${SLOPE_LIMIT}×` });
  }
  if (checks.length === 0) checks.push({ fn, level: 'pass', message: `within ${entry.pages} pages per call` });
  return checks;
};

/** Every RPC's checks, plus a failure for each budget entry that was never measured. */
export const checkBudgets = (
  budgets: Readonly<Record<string, BudgetEntry>>, measured: Readonly<Record<string, readonly PointCost[]>>,
): BudgetCheck[] => [
  ...Object.entries(measured).flatMap(([fn, points]) => checkBudget(fn, budgets[fn], points)),
  ...Object.keys(budgets).filter((fn) => !(fn in measured)).map((fn) => ({ fn, level: 'fail' as const, message: 'has a budget but no scenario' })),
];

const fmt = (value: number | undefined): string => {
  if (value === undefined) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
};

/** What a justified entry is excused from: the ceiling, the slope check, both, or neither. */
const exceptionLabel = (entry: BudgetEntry): string => [
  entry.pages > PAGE_CEILING ? 'over the ceiling' : null, entry.scoped ? null : 'slope not asserted',
].filter(Boolean).join(', ') || 'within the ceiling, scoped';

/**
 * The read-path table: one row per RPC, its cost at each point, its slope,
 * budget and verdict, against the ceiling; then why each justified entry is
 * over the ceiling or not slope-asserted, and every failure.
 */
export const readPathMarkdown = (
  budgets: Readonly<Record<string, BudgetEntry>>, measured: Readonly<Record<string, readonly PointCost[]>>,
  historyDays: readonly number[], checks: readonly BudgetCheck[],
): string => {
  const at = (fn: string, days: number) => measured[fn]?.find((point) => point.historyDays === days);
  const verdict = (fn: string) => {
    const levels = checks.filter((check) => check.fn === fn).map((check) => check.level);
    return levels.includes('fail') ? 'FAIL' : 'PASS';
  };
  const columns = historyDays.flatMap((days) => [`Pages H=${days}`, `Temp H=${days}`, `Seq scans H=${days}`]);
  const lines = [
    '### Read path — pages per call (strict)',
    '',
    `| RPC | Kind | Budget | ${columns.join(' | ')} | Slope/doubling | Verdict |`,
    `| --- | --- | --: | ${columns.map(() => '--:').join(' | ')} | --: | --- |`,
    ...[...new Set([...Object.keys(budgets), ...Object.keys(measured)])].map((fn) => {
      const cells = historyDays.flatMap((days) => {
        const point = at(fn, days);
        return point?.error ? [`error ${point.error}`, '—', '—'] : [fmt(point?.pages), fmt(point?.tempBytes), fmt(point?.seqScans)];
      });
      const entry = budgets[fn];
      return `| ${fn} | ${entry?.kind ?? '—'}${entry?.scoped ? ', scoped' : ''} | ${fmt(entry?.pages)} | ${cells.join(' | ')} | ${fmtSlope(historySlope(measured[fn] ?? []))} | ${verdict(fn)} |`;
    }),
    '',
    `Ceiling ${PAGE_CEILING} pages per call; a scoped RPC grows at most ${SLOPE_LIMIT}× per doubling of history.`,
    '',
    ...Object.entries(budgets).filter(([, entry]) => entry.justification?.trim())
      .map(([fn, entry]) => `- ${fn} (${exceptionLabel(entry)}): ${entry.justification!.trim()}`),
    ...checks.filter((check) => check.level !== 'pass').map((check) => `- ${check.level.toUpperCase()} ${check.fn}: ${check.message}`),
  ];
  return `${lines.join('\n')}\n`;
};
