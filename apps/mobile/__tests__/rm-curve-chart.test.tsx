import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { Platform, View, type ViewInstance } from 'react-native';
import { RmCurveChart } from '@/components/rm-curve/chart';
import { RmCurveContent, type CurveScope } from '@/components/rm-curve/content';
import { setDescription } from '@/components/rm-curve/details';
import { axisLabel, curveGeometry, pointsAt } from '@/components/rm-curve/geometry';
import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { assessSingleCurve } from '@/src/strength-regimes/assessment';
import { buildRmCurveModel } from '@/src/rm-curve/model';
import { loadRmCurve } from '@/src/rm-curve/repository';
import { exerciseSets, sessions } from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { seedWaveHistory, waveGraph } from './helpers/rm-curve-history';
import wave from './fixtures/rm-curve-weekly-wave.json';
import oracle from './fixtures/rm-curve-weekly-wave-oracle.json';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
const query = { exerciseDefinitionId: 'curve', start: new Date(wave.scenarios.plateau[0].startedAt),
  end: new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1), historyLookbackWeeks: 52, gym: { gymId: 'synthetic-gym' } };
const scope: CurveScope = { range: 'history', gym: { gymId: 'synthetic-gym' }, rir: null };
const props = { scope, onScope: jest.fn(), dateFormat: 'YYYY-MM-DD' as const, historyWeeks: 52, progressWeeks: 4 };
const read = (data: Awaited<ReturnType<typeof loadRmCurve>>) => ({ status: 'ready' as const, data, retry: jest.fn() });
beforeEach(() => { mockFixture = createInMemoryDatabase(); seedWaveHistory(mockFixture.database); });
afterEach(() => { mockFixture.close(); jest.restoreAllMocks(); });

it.each(['plateau', 'stable', 'gradual'] as const)('renders %s prefix coordinates and recency without gain styling or future points', name => {
  const graph = waveGraph(name);
  for (const expected of oracle.oracle.find(control => control.name === name)!.weekly) {
    const model = buildRmCurveModel(graph, { ...query, end: new Date(wave.scenarios[name][expected.week * 3 - 1].completedAt + 1) });
    const plot = curveGeometry(model, 300);
    expect(plot.points).toHaveLength(expected.sets);
    expect(plot.points.map(p => p.id)).toEqual(model.observations.map(p => p.setId));
    expect(model.curve).toHaveLength(20);
    expect(plot.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.recency >= 0 && p.recency <= 3)).toBe(true);
    const p = model.observations[0], mark = plot.points[0];
    expect(mark.x).toBe(plot.x(p.reps + p.rir)); expect(mark.y).toBe(plot.y(p.loadKg));
  }
});

it('selects overlapping marks inline without a set-list popup and preserves actual reps, effort, Weight and existing 1RM', async () => {
  const model = (await loadRmCurve(query))!;
  render(<RmCurveContent {...props} read={read(model)} />);
  expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  const plot = curveGeometry(model, 300), mark = plot.points[0];
  fireEvent.press(screen.getByTestId('rm-curve-plot'), { nativeEvent: { locationX: mark.x, locationY: mark.y } });
  const ids = pointsAt(plot, mark.x, mark.y, 44); expect(ids.length).toBeGreaterThan(1);
  const p = model.observations.find(p => ids[0] === p.setId)!;
  expect(screen.queryByText('View sets')).toBeNull();
  expect(screen.queryByTestId('rm-curve-sheet')).toBeNull();
  expect(screen.getByTestId('rm-curve-details')).toBeTruthy();
  expect(screen.getByText(`${p.reps} / ${p.rir}`)).toBeTruthy();
  expect(screen.getByText(`${formatWeight(p.weightKg)} / ${formatOneRepMax(p.existingOneRepMax)}`)).toBeTruthy();
  expect(screen.getByLabelText('Next set')).toBeDisabled();
  fireEvent.press(screen.getByLabelText('Previous set'));
  expect(screen.getByLabelText('Next set')).not.toBeDisabled();
});

it.each([2, 6, 10, 14, 18, 22])('renders the held-load/RIR and load-step readout at frozen week %s', async week => {
  const model = (await loadRmCurve({ ...query, end: new Date(wave.scenarios.plateau[week * 3 - 1].completedAt + 1) }))!;
  render(<RmCurveContent {...props} read={read(model)} />);
  const p = model.observations.find(p => p.setId === `week-${week}:1`)!;
  await screen.findByText('Exploratory fit');
  const mark = curveGeometry(model, 300, assessSingleCurve(model, 'fixed').curves).points.find(mark => mark.id === p.setId)!;
  expect(screen.getByTestId(`rm-point-${p.setId}`).props).toMatchObject({ cx: mark.x, cy: mark.y });
  expect(screen.queryByText(/Reference/)).toBeNull();
  await screen.findByText('Exploratory fit');
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByText(`${p.reps} / ${p.rir}`)).toBeTruthy();
  expect(screen.getByText(`${formatWeight(p.weightKg)} / ${formatOneRepMax(p.existingOneRepMax)}`)).toBeTruthy();
  expect(screen.queryByText(/strength gain|structural break|probability/i)).toBeNull();
});

it('opens inline values on coordinate-free chart activation and can browse every set without a popup', async () => {
  const model = (await loadRmCurve(query))!;
  render(<RmCurveContent {...props} read={read(model)} />);
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByTestId('rm-curve-details')).toBeTruthy();
  expect(screen.queryByTestId('rm-curve-sheet')).toBeNull();
  for (let i = 1; i < model.observations.length; i++) fireEvent.press(screen.getByLabelText('Previous set'));
  expect(screen.getByLabelText('Previous set')).toBeDisabled();
  expect(screen.getByLabelText('Next set')).not.toBeDisabled();
  const label = setDescription({ ...model.observations[0], loadContext: { ...model.observations[0].loadContext, loadInputMode: 'per_side_load' } }, 'YYYY-MM-DD');
  expect(label.match(/ per side/g)).toHaveLength(3);
  expect(label).not.toMatch(/\bkg\b/);
});

it('uses viewport mouse coordinates after document scrolling instead of shifted page coordinates', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const model = (await loadRmCurve(query))!, pick = jest.fn();
  const geometry = curveGeometry(model, 300), mark = geometry.points[0];
  render(<RmCurveChart model={model} selectedId={null} onPick={pick} />);
  jest.spyOn(screen.UNSAFE_getByType(View).instance as ViewInstance, 'measureInWindow')
    .mockImplementation(callback => callback(100, 200, 300, 252));
  fireEvent.press(screen.getByTestId('rm-curve-plot'), { nativeEvent: { clientX: mark.x + 100, clientY: mark.y + 200,
    pageX: mark.x + 100, pageY: mark.y + 400 } });
  expect(pick).toHaveBeenCalledWith(pointsAt(geometry, mark.x, mark.y, 44));
  expect(pick.mock.calls[0][0]).toContain(model.observations[0].setId);
});

it('shows an assumed one-rep halo only for positive RIR, scales it with the axis and preserves point picking', async () => {
  for (const [index, rir] of [2, 0, 12].entries()) {
    mockFixture.database.update(exerciseSets).set({ repsValue: '8', setType: `rir_${rir}` })
      .where(eq(exerciseSets.id, `week-24:${index + 1}`)).run();
  }
  const model = (await loadRmCurve({ ...query, start: new Date(wave.scenarios.plateau.at(-1)!.startedAt) }))!;
  const pick = jest.fn();
  render(<RmCurveChart model={model} selectedId="week-24:1" onPick={pick} />);
  // Highest equivalent count is 20; reserve the +1 assumption at the right edge.
  const unit = (300 - 38 - 24) / 21;
  const halo = screen.getByTestId('rm-halo-week-24:1');
  expect(halo.props.cx).toBeCloseTo(38 + 10 * unit);
  expect(halo.props.rx).toBeCloseTo(unit); expect(halo.props.ry).toBe(8);
  expect(halo.props.cx - halo.props.rx).toBeCloseTo(38 + 9 * unit);
  expect(halo.props.cx + halo.props.rx).toBeCloseTo(38 + 11 * unit);
  expect(screen.queryByTestId('rm-halo-week-24:2')).toBeNull();
  expect(screen.getByTestId('rm-halo-week-24:3').props.cx + unit).toBeCloseTo(276);
  const point = screen.getByTestId('rm-point-week-24:1');
  expect(point.props.cx).toBe(halo.props.cx); expect(point.props.cy).toBe(halo.props.cy);
  fireEvent.press(screen.getByTestId('rm-curve-plot'), { nativeEvent: { locationX: point.props.cx, locationY: point.props.cy } });
  expect(pick.mock.calls[0][0]).toContain('week-24:1');
  fireEvent(screen.getByTestId('rm-curve-plot'), 'layout', { nativeEvent: { layout: { width: 420 } } });
  expect(screen.getByTestId('rm-halo-week-24:1').props.rx).toBeCloseTo((420 - 38 - 24) / 21);
  expect(screen.getByTestId('rm-selection-caret')).toBeTruthy();
  expect(screen.getByLabelText(/assumed one-rep RIR range, not confidence/)).toBeTruthy();
});

it('keeps halos matched to the complete-session period without changing circle and diamond identity', async () => {
  const model = (await loadRmCurve(query))!;
  const boundary = model.observations.at(-1)!.completedAt.getTime();
  render(<RmCurveChart model={model} selectedId={null} onPick={jest.fn()} boundary={boundary} />);
  for (const point of model.observations.filter(point => point.rir > 0)) {
    const newer = point.completedAt.getTime() >= boundary;
    expect(screen.getByTestId(`rm-halo-${point.setId}`).props.fill.brushRef).toMatch(newer ? /-newer$/ : /-older$/);
    expect(screen.getByTestId(`rm-point-${point.setId}`).props[newer ? 'd' : 'cx']).toBeDefined();
  }
});

it('retains named gym labels on read failure and distinguishes an empty RIR filter from missing effort', async () => {
  mockFixture.database.update(exerciseSets).set({ setType: null }).where(eq(exerciseSets.id, 'week-24:1')).run();
  const model = (await loadRmCurve({ ...query, rir: 12 }))!;
  const component = render(<RmCurveContent {...props} scope={{ ...scope, gym: { gymId: 'synthetic-gym' }, rir: 12 }} read={read(model)} />);
  expect(screen.getByText('No sets match these filters')).toBeTruthy();
  component.rerender(<RmCurveContent {...props} scope={{ ...scope, gym: { gymId: 'synthetic-gym' }, rir: 12 }} read={{ status: 'error', data: model, retry: jest.fn() }} />);
  expect(screen.getByLabelText('gym: Synthetic gym')).toBeTruthy(); expect(screen.queryByLabelText('gym: No gym')).toBeNull();
});

it('preserves still-visible selection, clears removed IDs, and never resurrects them or stale details', async () => {
  const model = (await loadRmCurve(query))!;
  const component = render(<RmCurveContent {...props} read={read(model)} />);
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  component.rerender(<RmCurveContent {...props} read={read(await loadRmCurve({ ...query, rir: model.observations[0].rir }))} />);
  expect(screen.getByTestId('rm-curve-details')).toBeTruthy();
  mockFixture.database.update(exerciseSets).set({ deletedAt: query.end }).where(eq(exerciseSets.id, model.observations[0].setId)).run();
  component.rerender(<RmCurveContent {...props} read={read(await loadRmCurve(query))} />);
  expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  mockFixture.database.update(exerciseSets).set({ deletedAt: null }).where(eq(exerciseSets.id, model.observations[0].setId)).run();
  component.rerender(<RmCurveContent {...props} read={read(await loadRmCurve(query))} />);
  expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  const retry = jest.fn();
  component.rerender(<RmCurveContent {...props} read={{ status: 'error', data: model, retry }} />);
  expect(screen.queryByTestId('rm-curve-plot')).toBeNull(); expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  fireEvent.press(screen.getByLabelText('Retry')); expect(retry).toHaveBeenCalledTimes(1);
  component.rerender(<RmCurveContent {...props} read={{ status: 'loading', data: model, retry }} />);
  expect(screen.getByText('Loading sets')).toBeTruthy(); expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
});

it('renders sparse, insufficient reference, missing/unknown effort, zero and high RIR from real SQLite', async () => {
  mockFixture.database.update(sessions).set({ deletedAt: query.end }).where(eq(sessions.id, 'week--1')).run();
  mockFixture.database.update(exerciseSets).set({ setType: null }).where(eq(exerciseSets.id, 'week-24:1')).run();
  mockFixture.database.update(exerciseSets).set({ setType: 'unexpected_effort' }).where(eq(exerciseSets.id, 'week-24:2')).run();
  mockFixture.database.update(exerciseSets).set({ setType: 'rir_12', weightValue: '0' }).where(eq(exerciseSets.id, 'week-24:3')).run();
  const model = (await loadRmCurve({ ...query, start: new Date(wave.scenarios.plateau.at(-1)!.startedAt) }))!;
  // Canonical high RIR has no qualifying prior reference.
  const sparse = (await loadRmCurve({ ...query, rir: 12 }))!;
  render(<RmCurveContent {...props} read={read(sparse)} />);
  await screen.findByText('Fit unavailable');
  expect(screen.getByText('1 fitting sessions')).toBeTruthy();
  expect(screen.queryByText(/Reference/)).toBeNull();
  expect(screen.queryByTestId('rm-reference-line')).toBeNull(); expect(screen.getByTestId('rm-point-week-24:3').props.cy).toBe(228);
  expect(screen.getByText(/1 missing effort; 1 unknown effort/)).toBeTruthy();
  expect(model.observations.length).toBe(1);
});

it('offers all available canonical efforts and bounded range choices and retains scope on retry', async () => {
  const model = (await loadRmCurve(query))!;
  function Harness() {
    const [current, setScope] = useState(scope);
    return <RmCurveContent {...props} historyWeeks={8} progressWeeks={4} read={read(model)} scope={current} onScope={setScope} />;
  }
  render(<Harness />);
  fireEvent.press(screen.getByLabelText('effort: All known RIR')); fireEvent.press(screen.getByRole('radio', { name: 'RIR 4' }));
  expect(screen.getByLabelText('effort: RIR 4')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('range: History look-back (8 weeks)'));
  fireEvent.press(screen.getByRole('radio', { name: 'Progress period (4 weeks)' }));
  expect(screen.getByLabelText('range: Progress period (4 weeks)')).toBeTruthy();
});

it('keeps every finite zero/extreme/dense observation on the plot without spread-argument overflow', () => {
  const model = buildRmCurveModel(waveGraph('plateau'), query);
  const base = model.observations[0];
  const dense = { ...model, observations: Array.from({ length: 100000 }, (_, i) => ({ ...base, setId: String(i), loadKg: i ? Number.MAX_VALUE : 0, equivalentReps: Number.MAX_SAFE_INTEGER })) };
  const plot = curveGeometry(dense, 300);
  expect(plot.points).toHaveLength(100000); expect(plot.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  expect(Math.min(...plot.points.slice(0, 2).map(p => p.y)) - 12).toBeGreaterThan(1);
  expect(pointsAt(plot, -100, -100, 44)).toEqual([]);
  expect(axisLabel(Number.MAX_VALUE)).toBe('1.8e+308'); expect(axisLabel(Number.MAX_SAFE_INTEGER)).toBe('9.0e+15');
});
