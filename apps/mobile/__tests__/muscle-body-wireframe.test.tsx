import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { createMuscleWireframeRenderer } from '@/components/stats/muscle-wireframe-renderer';
import { BODY_WIRE_INSTANCES, hitWireframe, projectWireframePoint, wireframeCamera } from '@/components/stats/muscle-wireframe-scene';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';
import { recordingGL } from './helpers/muscle-wireframe';
import { compareProgressVolume } from '@/src/data/progress-comparisons';
import { themePresets } from '@/components/ui/theme-presets';
import type { ProgressMuscleComparison } from '@/src/data';

jest.mock('@/components/stats/muscle-wireframe-renderer', () => ({ createMuscleWireframeRenderer: jest.fn() }));
const createRenderer = jest.mocked(createMuscleWireframeRenderer);
function visibleBrachialisPoint(camera: ReturnType<typeof wireframeCamera>) {
  const mesh = BODY_WIRE_INSTANCES.find(mesh => mesh.group === 'brachialis')!;
  return mesh.part.faces.map(face => {
    const centre = [0, 1, 2].map(k => face.slice(0, 3).reduce((n, i) => n + mesh.part.vertices[i][k], 0) / 3);
    return projectWireframePoint(centre as [number, number, number], camera).slice(0, 2) as [number, number];
  }).find(point => hitWireframe({ point, camera, selected: [], selectedId: null }) === 'brachialis')!;
}
const muscles: ProgressMuscleComparison[] = [{ muscleGroupId: 'brachialis', displayName: 'Brachialis', familyName: 'Arms', sortOrder: 0,
  current: { workingSetCount: 4, totalVolume: 100, volumeSetCount: 1 }, previous: { workingSetCount: 2, totalVolume: 50, volumeSetCount: 1 },
  workingSetChange: 2, volumeChange: compareProgressVolume(100, 50), exercises: [] }];
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('defaults to native wireframe, preserves rotation and focus, and updates the mounted live theme', async () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  const canvas = view.getByTestId('stats-muscle-body-wireframe');
  fireEvent(canvas, 'contextCreate', recordingGL().context);
  act(() => { jest.advanceTimersByTime(20); });
  const initial = renderer.draw.mock.calls.at(-1)![0];
  expect(initial.selected).toHaveLength(2);
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-focus'));
  act(() => { jest.advanceTimersByTime(20); });
  expect(renderer.draw.mock.calls.at(-1)![0].selected).toHaveLength(1);
  expect(view.getByTestId('stats-muscle-body-framing-focus').props.accessibilityState).toMatchObject({ selected: true });
  fireEvent(view.getByTestId('stats-muscle-body-viewport'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  act(() => { jest.advanceTimersByTime(20); });
  expect(view.getByTestId('stats-muscle-body-viewport').props.accessibilityValue.text).toContain('30 degrees');
  const choice = { theme: themePresets[1].id, mode: 'dark', custom: null } as const;
  await switchTheme(choice);
  act(() => { jest.advanceTimersByTime(20); });
  expect(renderer.draw.mock.calls.at(-1)![0].roles).toEqual(rolesFor(choice));
  expect(createRenderer).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('stats-muscle-body-comparison')).toBeTruthy();
});

it('keeps Retry accessible outside the adjustable viewport and preserves the picker and patch toggle after GL failure', () => {
  createRenderer.mockImplementation(() => { throw new Error('native context failure'); });
  const props = { muscles, metric: 'workingSetCount', selectedId: 'brachialis', onSelect: jest.fn() } as const;
  const view = renderWithTheme(<MuscleBodyCard {...props} />);
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  expect(view.getByTestId('stats-muscle-wireframe-error')).toBeTruthy();
  const retry = view.getByTestId('stats-muscle-wireframe-retry');
  let parent = retry.parent;
  while (parent) { expect(parent.props.accessibilityRole).not.toBe('adjustable'); parent = parent.parent; }
  expect(view.getByTestId('stats-muscle-body-framing-focus')).toBeDisabled();
  expect(view.getByTestId('stats-muscle-body-framing-body')).not.toBeDisabled();
  fireEvent.press(retry);
  expect(view.getByTestId('stats-muscle-body-wireframe')).toBeTruthy();
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  expect(view.getByTestId('stats-muscle-wireframe-error')).toBeTruthy();
  view.rerender(<MuscleBodyCard {...props} overlay="contour" />);
  expect(view.getByTestId('stats-muscle-body-patches')).toBeTruthy();
  expect(view.getByTestId('stats-muscle-body-picker-trigger')).toBeTruthy();
  view.rerender(<MuscleBodyCard {...props} />);
  expect(view.getByTestId('stats-muscle-body-wireframe')).toBeTruthy();
});

it('keeps the selected coarse geometry, focused camera, native context and hit testing when switching to patches', () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-focus'));
  act(() => { jest.advanceTimersByTime(20); });
  const viewport = view.getByTestId('stats-muscle-body-viewport');
  for (let step = 0; step < 3; step++) fireEvent(viewport, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  act(() => { jest.advanceTimersByTime(20); });
  const before = renderer.draw.mock.calls.at(-1)![0];
  view.rerender(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} overlay="contour" />);
  act(() => { jest.advanceTimersByTime(20); });
  const after = renderer.draw.mock.calls.at(-1)![0];
  expect(after.overlay).toBe('contour'); expect(after.selected).toBe(before.selected); expect(after.camera).toBe(before.camera);
  expect(view.getByTestId('stats-muscle-body-patches')).toBeTruthy();
  expect(view.getByTestId('stats-muscle-body-framing-focus').props.accessibilityState).toMatchObject({ selected: true });
  expect(createRenderer).toHaveBeenCalledTimes(1);
  const [x, y] = visibleBrachialisPoint(after.camera);
  const tap = viewport.props.gesture.gestures.find((g: { type: string }) => g.type === 'tap');
  tap.handlers.onEnd({ x, y });
  expect(onSelect).toHaveBeenCalledWith('brachialis');
});

it('uses the wireframe camera for taps, ignores invalid coordinates, and keeps custom selections without fake geometry', () => {
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  const viewport = view.getByTestId('stats-muscle-body-viewport');
  fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 420 } } });
  for (let step = 0; step < 3; step++) fireEvent(viewport, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  const camera = wireframeCamera({ angle: 90, width: 280, height: 420, selected: [], focus: false });
  const projected = visibleBrachialisPoint(camera);
  const tap = viewport.props.gesture.gestures.find((gesture: { type: string }) => gesture.type === 'tap');
  act(() => { tap.handlers.onEnd({ x: projected[0], y: projected[1] }); });
  expect(onSelect).toHaveBeenCalledWith('brachialis');
  onSelect.mockClear(); tap.handlers.onEnd({ x: NaN, y: 5 }); expect(onSelect).not.toHaveBeenCalled();
  const custom = { ...muscles[0], muscleGroupId: 'custom', displayName: 'Custom' };
  view.rerender(<MuscleBodyCard muscles={[custom]} metric="workingSetCount" selectedId="custom" onSelect={onSelect} />);
  expect(view.getByTestId('stats-muscle-body-framing-focus')).toBeDisabled();
  expect(view.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Custom');
  expect(view.getByTestId('stats-muscle-body-comparison')).toBeTruthy();
});

it('fits the whole figure and controls on compact phones while retaining the larger normal viewport', () => {
  const original = Dimensions.get('window');
  try {
    act(() => Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 } }));
    const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={jest.fn()} />);
    expect(StyleSheet.flatten(view.getByTestId('stats-muscle-body-viewport').props.style).height).toBe(280);
    act(() => Dimensions.set({ window: { width: 402, height: 874, scale: 3, fontScale: 1 } }));
    expect(StyleSheet.flatten(view.getByTestId('stats-muscle-body-viewport').props.style).height).toBe(420);
  } finally { act(() => Dimensions.set({ window: original })); }
});

it.each([320, 375, 402])('keeps a wrapping muscle strip separate from explicit viewer controls at %spt', width => {
  const original = Dimensions.get('window');
  try {
    act(() => Dimensions.set({ window: { width, height: 667, scale: 2, fontScale: 1 } }));
    const view = renderWithTheme(<MuscleBodyCard muscles={[{ ...muscles[0], displayName: 'A very long custom muscle name' }]}
      metric="workingSetCount" selectedId="brachialis" onSelect={jest.fn()} />);
    const name = view.getByTestId('stats-muscle-body-selected');
    expect(name.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(name.props.style).textTransform).not.toBe('uppercase');
    expect(view.getByTestId('stats-muscle-body-framing-body').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getByTestId('stats-muscle-body-framing-focus')).toHaveTextContent('Focus');
    expect(view.queryByTestId('stats-muscle-body-next')).toBeNull();
    expect(view.queryByTestId('stats-muscle-body-prev')).toBeNull();
    expect(view.getByTestId('stats-muscle-body-wireframe')).toBeTruthy();
  } finally { act(() => Dimensions.set({ window: original })); }
});

it('pages only completed horizontal strip swipes, wraps, and leaves body rotation independent', () => {
  const rows = [muscles[0], { ...muscles[0], muscleGroupId: 'back_lats', displayName: 'Lats' }];
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={rows} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  const strip = view.getByTestId('stats-muscle-body-picker-trigger');
  const swipe = (x: number, y: number, success = true) => act(() => {
    strip.props.gesture.handlers.onEnd({ translationX: x, translationY: y }, success);
  });
  expect(strip.props.accessibilityActions).toEqual([
    { name: 'previous', label: 'Previous muscle' }, { name: 'next', label: 'Next muscle' },
  ]);
  swipe(-70, 0, false);
  swipe(0, 70);
  swipe(12, 0);
  swipe(-70, 90);
  expect(onSelect).not.toHaveBeenCalled();
  swipe(-70, 0);
  expect(onSelect).toHaveBeenLastCalledWith('back_lats');
  expect(view.getByTestId('stats-muscle-body-viewport').props.accessibilityValue.text).toBe('Back view, 180 degrees');
  onSelect.mockClear();
  const pan = view.getByTestId('stats-muscle-body-viewport').props.gesture.gestures.find((g: { type: string }) => g.type === 'pan');
  act(() => pan.handlers.onEnd({ translationX: 40 }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(view.getByTestId('stats-muscle-body-viewport').props.accessibilityValue.text).toContain('214 degrees');
  swipe(70, 0);
  expect(onSelect).toHaveBeenLastCalledWith('back_lats');
});

it.each([{ rows: [] }, { rows: muscles }])('keeps empty and single-muscle strips stable', ({ rows }) => {
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={rows} metric="workingSetCount" selectedId={rows[0]?.muscleGroupId ?? null} onSelect={onSelect} />);
  const strip = view.getByTestId('stats-muscle-body-picker-trigger');
  act(() => strip.props.gesture.handlers.onEnd({ translationX: -70, translationY: 0 }, true));
  fireEvent(strip, 'accessibilityAction', { nativeEvent: { actionName: 'previous' } });
  fireEvent(strip, 'accessibilityAction', { nativeEvent: { actionName: 'unknown' } });
  expect(onSelect).not.toHaveBeenCalled();
  expect(view.getByTestId('stats-muscle-body-selected')).toHaveTextContent(rows.length ? 'Brachialis' : 'Select');
});

it.each(['workingSetCount', 'totalVolume'] as const)('retains every picker value and a separate selected checkmark in %s', metric => {
  const rows = [...muscles, { ...muscles[0], muscleGroupId: 'custom', displayName: 'A long custom muscle name',
    current: { workingSetCount: 0, totalVolume: 123456789012345, volumeSetCount: 1 } }];
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={rows} metric={metric} selectedId="brachialis" onSelect={onSelect} />);
  fireEvent.press(view.getByTestId('stats-muscle-body-picker-trigger'));
  expect(view.getByTestId('stats-muscle-picker-value-brachialis')).toHaveTextContent(metric === 'workingSetCount' ? '4 sets' : '100 volume');
  expect(view.getByTestId('stats-muscle-picker-value-custom')).toHaveTextContent(metric === 'workingSetCount' ? '0 sets' : '123456789012345 volume');
  expect(view.getByTestId('stats-muscle-picker-check-brachialis', { includeHiddenElements: true })).toBeTruthy();
  expect(view.queryByTestId('stats-muscle-picker-check-custom', { includeHiddenElements: true })).toBeNull();
  fireEvent(view.getByTestId('stats-muscle-picker-sheet'), 'accessibilityEscape');
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('stats-muscle-body-picker-trigger'));
  fireEvent.press(view.getByTestId('stats-muscle-picker-row-custom'));
  expect(onSelect).toHaveBeenCalledWith('custom');
  expect(view.queryByTestId('stats-muscle-picker-sheet')).toBeNull();
});

it('can leave Focus after selecting an unmapped muscle or losing the model', () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-focus'));
  const custom = { ...muscles[0], muscleGroupId: 'custom', displayName: 'Custom' };
  view.rerender(<MuscleBodyCard muscles={[custom]} metric="workingSetCount" selectedId="custom" onSelect={onSelect} />);
  expect(view.getByTestId('stats-muscle-body-framing-focus')).toBeDisabled();
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-body'));
  expect(view.getByTestId('stats-muscle-body-framing-body').props.accessibilityState).toMatchObject({ selected: true });
  view.rerender(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-focus'));
  createRenderer.mockImplementation(() => { throw new Error('lost native context'); });
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  expect(view.getByTestId('stats-muscle-wireframe-error')).toBeTruthy();
  fireEvent.press(view.getByTestId('stats-muscle-body-framing-body'));
  expect(view.getByTestId('stats-muscle-body-framing-body').props.accessibilityState).toMatchObject({ selected: true });
  expect(onSelect).not.toHaveBeenCalled();
});
