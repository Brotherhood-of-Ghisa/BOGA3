import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { RmCurveContent } from '@/components/rm-curve/content';
import { periodLabel, selectedPeriod } from '@/components/rm-curve/regimes';
import { curveGeometry } from '@/components/rm-curve/geometry';
import { ALL_GYMS, buildRmCurveModel } from '@/src/rm-curve/model';
import { assessRegimes, assessSingleCurve } from '@/src/strength-regimes/assessment';
import { fitStrengthRegimes, iterateStrengthRegimes, iterateStrengthTrajectory, prepareRegimePoints, FitWorkLimitError } from '@/src/strength-regimes/fit';
import { useRegimeAssessment } from '@/src/strength-regimes/use-assessment';
import { generateRegimeHistory } from './helpers/regime-reliability-research';
import { waveGraph } from './helpers/rm-curve-history';

const graph = waveGraph();
const query = { start: new Date(2026, 0, 1), end: new Date(2027, 0, 1), historyLookbackWeeks: 52 };
const model = () => buildRmCurveModel(graph, query);

afterEach(() => jest.useRealTimers());

it('pools gyms without duplicates, samples first working ordinal before effort selection, and never replaces missing effort', () => {
  const g = waveGraph(), first = g.rows.find(r => r.setOrder === 0 && r.completedAt >= query.start)!;
  g.rows.filter(r => r.sessionId === first.sessionId).forEach(r => { r.gymId = null; r.gymName = null; });
  first.setType = null;
  const all = buildRmCurveModel(g, { ...query, gymId: ALL_GYMS });
  const one = buildRmCurveModel(g, { ...query, gymId: 'synthetic-gym' });
  expect(all.observations.length).toBeGreaterThan(one.observations.length);
  expect(new Set(all.observations.map(p => p.setId)).size).toBe(all.observations.length);
  expect(all.inferenceSessions.find(s => s.sessionId === first.sessionId)?.firstWorkingSet).toBeNull();
  const filtered = buildRmCurveModel(g, { ...query, gymId: ALL_GYMS, rir: 0 });
  for (const s of filtered.inferenceSessions) {
    const first = all.inferenceSessions.find(x => x.sessionId === s.sessionId)!;
    expect(s.firstWorkingSet).toEqual(first.firstWorkingSet?.rir === 0 ? first.firstWorkingSet : null);
  }
});

it.each(['fixed', 'joint'] as const)('preserves the reviewed %s fitter results across yielding boundaries and free strength increments', method => {
  const sessions = generateRegimeHistory('step10', 37201).sessions;
  const expected = fitStrengthRegimes(sessions, { method });
  const iterator = iterateStrengthRegimes(sessions, { method });
  let next = iterator.next(), chunks = 0;
  while (!next.done) { chunks++; next = iterator.next(); }
  expect(chunks).toBeGreaterThan(expected.noBreakFits.length + expected.cutProfile.length);
  expect(next.value).toEqual(expected);
  const assessment = assessRegimes(model(), expected);
  expect(assessment.evidence).toBe(expected.evidence);
  if (expected.status === 'fitted') {
    expect(assessment.boundary).toBe(expected.candidate!.rightTime);
    expect(assessment.curves.map(c => c.totalRm)).toEqual(expected.candidate!.controls);
    expect(assessment.message).toBe('Exploratory fit');
  }
});

it('does not draw unsupported results, historical fallbacks or probability claims', () => {
  const m = model();
  const fit = fitStrengthRegimes(generateRegimeHistory('step10', 37201).sessions, { method: 'fixed' });
  expect(assessRegimes(m, { ...fit, status: 'unresolved' }).curves).toEqual([]);
  expect(assessRegimes(m, { ...fit, status: 'insufficient' }).message).toBe('More sessions needed');
  expect(assessSingleCurve({ ...m, inferenceSessions: [] }, 'fixed').curves).toEqual([]);
  const single = assessSingleCurve(m, 'fixed');
  expect(single.curves).toHaveLength(1);
  const plot = curveGeometry(m, 320, single.curves);
  expect(plot.lines).toHaveLength(1);
  expect(plot.lines[0].totalRm).not.toBe(m.reference.totalRm);
});

it('cancels queued fits and never exposes another snapshot or method result', () => {
  jest.useFakeTimers();
  const m = model(), sparse = { ...m, inferenceSessions: [] };
  const hook = renderHook(({ current, method }: { current: ReturnType<typeof model>; method: 'fixed' | 'joint' }) => useRegimeAssessment(current, 'two', method),
    { initialProps: { current: m, method: 'fixed' as 'fixed' | 'joint' } });
  act(() => { jest.advanceTimersToNextTimer(); });
  hook.rerender({ current: sparse, method: 'joint' });
  expect(hook.result.current).toBeNull();
  act(() => { jest.runAllTimers(); });
  expect(hook.result.current?.data?.message).toBe('More sessions needed');
  expect(hook.result.current?.model).toBe(sparse);
  hook.rerender({ current: m, method: 'fixed' });
  expect(hook.result.current).toBeNull();
  hook.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('contains fitting failure and retries on a new input snapshot without leaking an old curve', () => {
  jest.useFakeTimers();
  const m = model(), bad = { ...m, inferenceSessions: [{ sessionId: 'bad', time: 1,
    firstWorkingSet: { setId: 'bad', reps: 1, rir: NaN, load: 10 } }] };
  const hook = renderHook(({current}: {current: ReturnType<typeof model>}) => useRegimeAssessment(current, 'one', 'fixed'), { initialProps: { current: bad } });
  act(() => { jest.runAllTimers(); });
  expect(hook.result.current?.error).toBe(true);
  expect(hook.result.current?.data).toBeNull();
  hook.rerender({ current: m });
  expect(hook.result.current).toBeNull();
  act(() => { jest.runAllTimers(); });
  expect(hook.result.current?.data?.curves).toHaveLength(1);
});

it('defaults to One curve and Parsimonious, keeps controls on failure, and offers All gyms', () => {
  jest.useFakeTimers();
  const onScope = jest.fn();
  const props = { read: { status: 'ready' as const, data: model(), retry: jest.fn() },
    scope: { exerciseId: 'curve', range: 24 as const, rir: null }, onScope,
    exercises: [{ id: 'curve', name: 'Synthetic exercise' }], catalogStatus: 'ready' as const,
    retryCatalog: jest.fn(), dateFormat: 'YYYY-MM-DD' as const, historyWeeks: 52 };
  const component = render(<RmCurveContent {...props} />);
  expect(screen.getByTestId('rm-mode-one').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('rm-method-fixed').props.accessibilityState.selected).toBe(true);
  act(() => { jest.runAllTimers(); });
  expect(screen.getByTestId('rm-fit-all')).toBeTruthy();
  expect(screen.queryByText(/Reference/)).toBeNull();
  fireEvent.press(screen.getByLabelText('gym: Synthetic gym'));
  fireEvent.press(screen.getByRole('radio', { name: 'All gyms' }));
  expect(onScope).toHaveBeenCalledWith(expect.objectContaining({ gymId: ALL_GYMS }));
  fireEvent.press(screen.getByTestId('rm-mode-two'));
  fireEvent.press(screen.getByTestId('rm-method-joint'));
  expect(screen.queryByTestId('rm-fit-all')).toBeNull();
  act(() => { jest.runAllTimers(); });
  component.rerender(<RmCurveContent {...props} read={{...props.read, status: 'error'}} />);
  expect(screen.getByTestId('rm-mode-two').props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('rm-method-joint').props.accessibilityState.selected).toBe(true);
  expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
});

it('updates selected-set temporal identity on a changed boundary and removes invalidated identity', () => {
  const m = model(), fit = fitStrengthRegimes(generateRegimeHistory('step10', 37201).sessions, { method: 'fixed' });
  const a = assessRegimes(m, fit);
  expect(a.curves).toHaveLength(2);
  expect(selectedPeriod(new Date(a.boundary! - 1), a)).toBe('older');
  expect(selectedPeriod(new Date(a.boundary!), a)).toBe('newer');
  expect(selectedPeriod(new Date(a.boundary!), { ...a, boundary: a.boundary! + 1 })).toBe('older');
  expect(selectedPeriod(new Date(), null)).toBeUndefined();
  expect(selectedPeriod(new Date(), { ...a, curves: [] })).toBeUndefined();
  expect(periodLabel('all', null, 'YYYY-MM-DD')).toBe('All dates');
  expect(periodLabel('newer', new Date(2026, 9, 15).getTime(), 'YYYY-MM-DD')).toBe('From 2026-10-15');
});

it('yields within a long trajectory, caps work before the next evaluation, and closes cancelled work', () => {
  const sessions = Array.from({ length: 1000 }, (_, i) => ({ sessionId: `long-${i}`, time: i,
    firstWorkingSet: { setId: `long-set-${i}`, reps: 5, rir: i % 4, load: 80 + i % 3 } }));
  const points = prepareRegimePoints(sessions), budget = { remaining: 20_000 };
  const fit = iterateStrengthTrajectory(points, 'quadratic', { method: 'joint' }, undefined, budget);
  expect(fit.next().done).toBe(false);
  expect(budget.remaining).toBeGreaterThan(0);
  expect(budget.remaining).toBeLessThan(20_000);
  let chunks = 1;
  expect(() => {
    while (true) {
      const before = budget.remaining, next = fit.next();
      expect(before - budget.remaining).toBeLessThanOrEqual(7000);
      if (next.done) break;
      chunks++;
    }
  }).toThrow(FitWorkLimitError);
  expect(chunks).toBeGreaterThan(1);
  expect(budget.remaining).toBe(0);
  const cancelled = iterateStrengthTrajectory(points, 'constant', { method: 'fixed' }, undefined, { remaining: 20_000 });
  expect(cancelled.next().done).toBe(false);
  expect(cancelled.return(undefined as never).done).toBe(true);
  expect(cancelled.next().done).toBe(true);
  expect(() => fitStrengthRegimes(sessions, { method: 'fixed', maxPointEvaluations: 0 })).toThrow('invalid regime options');
});

it('bounds a thousand-session UI request, retains every plotted point, and recovers after narrowing', () => {
  jest.useFakeTimers();
  const m = model();
  const large = { ...m, inferenceSessions: Array.from({ length: 1000 }, (_, i) => ({ sessionId: `long-${i}`, time: i,
    firstWorkingSet: { setId: `long-set-${i}`, reps: 5, rir: i % 4, load: 80 + i % 3 } })) };
  const props = { read: { status: 'ready' as const, data: large, retry: jest.fn() },
    scope: { exerciseId: 'curve', range: 'history' as const, rir: null }, onScope: jest.fn(),
    exercises: [{ id: 'curve', name: 'Synthetic exercise' }], catalogStatus: 'ready' as const,
    retryCatalog: jest.fn(), dateFormat: 'YYYY-MM-DD' as const, historyWeeks: 520 };
  const view = render(<RmCurveContent {...props} />);
  fireEvent.press(screen.getByTestId('rm-mode-two'));
  act(() => { jest.runAllTimers(); });
  expect(screen.getByText('Choose a shorter range')).toBeTruthy();
  expect(screen.getAllByTestId(/^rm-point-/)).toHaveLength(m.observations.length);
  expect(screen.queryAllByTestId(/^rm-fit-/)).toHaveLength(1); // Only the state label, never a partial curve.
  expect(screen.queryByTestId('rm-fit-older')).toBeNull();
  expect(screen.queryByTestId('rm-fit-newer')).toBeNull();
  view.rerender(<RmCurveContent {...props} read={{ ...props.read, data: m }} />);
  expect(screen.getByText('Fitting curves')).toBeTruthy();
  act(() => { jest.runAllTimers(); });
  expect(screen.queryByText('Choose a shorter range')).toBeNull();
  expect(screen.getByTestId('rm-fit-older')).toBeTruthy();
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('shares the work budget across completed competitors instead of resetting it per trajectory', () => {
  const sessions = generateRegimeHistory('step10', 37201).sessions;
  const budget = { remaining: 1_000_000 };
  const constant = iterateStrengthTrajectory(prepareRegimePoints(sessions), 'constant', { method: 'fixed' }, undefined, budget);
  let constantChunks = 0;
  while (!constant.next().done) constantChunks++;
  const profile = iterateStrengthRegimes(sessions, { method: 'fixed', maxPointEvaluations: 1_000_000 - budget.remaining });
  for (let i = 0; i < constantChunks + 1; i++) expect(profile.next().done).toBe(false);
  expect(() => profile.next()).toThrow(FitWorkLimitError);
});
