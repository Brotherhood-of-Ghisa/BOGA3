import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { createMuscleWireframeRenderer } from '@/components/stats/muscle-wireframe-renderer';
import { selectMuscleMeshes, projectWireframePoint, wireframeCamera } from '@/components/stats/muscle-wireframe-scene';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';
import { recordingGL } from './helpers/muscle-wireframe';
import { compareProgressVolume } from '@/src/data/progress-comparisons';
import { themePresets } from '@/components/ui/theme-presets';
import type { ProgressMuscleComparison } from '@/src/data';

jest.mock('@/components/stats/muscle-wireframe-renderer', () => ({ createMuscleWireframeRenderer: jest.fn() }));
const createRenderer = jest.mocked(createMuscleWireframeRenderer);
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
  fireEvent.press(view.getByTestId('stats-muscle-body-focus'));
  act(() => { jest.advanceTimersByTime(20); });
  expect(renderer.draw.mock.calls.at(-1)![0].selected).toHaveLength(1);
  expect(view.getByTestId('stats-muscle-body-focus')).toHaveTextContent('Whole body');
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
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={jest.fn()} />);
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  expect(view.getByTestId('stats-muscle-wireframe-error')).toBeTruthy();
  const retry = view.getByTestId('stats-muscle-wireframe-retry');
  let parent = retry.parent;
  while (parent) { expect(parent.props.accessibilityRole).not.toBe('adjustable'); parent = parent.parent; }
  fireEvent.press(retry);
  expect(view.getByTestId('stats-muscle-body-wireframe')).toBeTruthy();
  fireEvent.press(view.getByTestId('stats-muscle-body-overlay-toggle'));
  expect(view.getByTestId('stats-muscle-body-patches')).toBeTruthy();
  expect(view.getByTestId('stats-muscle-body-picker-trigger')).toBeTruthy();
});

it('keeps the selected coarse geometry, focused camera, native context and hit testing when switching to patches', () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  fireEvent.press(view.getByTestId('stats-muscle-body-focus'));
  act(() => { jest.advanceTimersByTime(20); });
  const before = renderer.draw.mock.calls.at(-1)![0];
  fireEvent.press(view.getByTestId('stats-muscle-body-overlay-toggle'));
  act(() => { jest.advanceTimersByTime(20); });
  const after = renderer.draw.mock.calls.at(-1)![0];
  expect(after.overlay).toBe('contour'); expect(after.selected).toBe(before.selected); expect(after.camera).toBe(before.camera);
  expect(view.getByTestId('stats-muscle-body-patches')).toBeTruthy();
  expect(view.getByTestId('stats-muscle-body-focus')).toHaveTextContent('Whole body');
  expect(createRenderer).toHaveBeenCalledTimes(1);
  const centre = [0, 1, 2].map(k => after.selected[0].part.vertices.reduce((n: number,p: number[]) => n+p[k],0)/after.selected[0].part.vertices.length);
  const [x,y] = projectWireframePoint(centre as [number,number,number], after.camera);
  const viewport = view.getByTestId('stats-muscle-body-viewport');
  const tap = viewport.props.gesture.gestures.find((g: { type: string }) => g.type === 'tap');
  tap.handlers.onEnd({ x, y });
  expect(onSelect).toHaveBeenCalledWith('brachialis');
});

it('uses the wireframe camera for taps, ignores invalid coordinates, and keeps custom selections without fake geometry', () => {
  const onSelect = jest.fn();
  const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={onSelect} />);
  const viewport = view.getByTestId('stats-muscle-body-viewport');
  fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 420 } } });
  const camera = wireframeCamera({ angle: 0, width: 280, height: 420, selected: [], focus: false });
  const meshes = selectMuscleMeshes('brachialis');
  const mesh = meshes[0], face = mesh.part.faces[0];
  const point = [0, 1, 2].map(axis => face.reduce((n, i) => n + mesh.part.vertices[i][axis], 0) / 3) as [number, number, number];
  const projected = projectWireframePoint(point, camera);
  const tap = viewport.props.gesture.gestures.find((gesture: { type: string }) => gesture.type === 'tap');
  act(() => { tap.handlers.onEnd({ x: projected[0], y: projected[1] }); });
  expect(onSelect).toHaveBeenCalledWith('brachialis');
  onSelect.mockClear(); tap.handlers.onEnd({ x: NaN, y: 5 }); expect(onSelect).not.toHaveBeenCalled();
  const custom = { ...muscles[0], muscleGroupId: 'custom', displayName: 'Custom' };
  view.rerender(<MuscleBodyCard muscles={[custom]} metric="workingSetCount" selectedId="custom" onSelect={onSelect} />);
  expect(view.queryByTestId('stats-muscle-body-focus')).toBeNull();
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

it.each([320, 375, 402])('keeps the full Wireframe selector label at %spt without a compact-filter width cap', width => {
  const original = Dimensions.get('window');
  try {
    act(() => Dimensions.set({ window: { width, height: 667, scale: 2, fontScale: 1 } }));
    const view = renderWithTheme(<MuscleBodyCard muscles={muscles} metric="workingSetCount" selectedId="brachialis" onSelect={jest.fn()} />);
    const selector = view.getByTestId('stats-muscle-body-overlay-toggle');
    expect(selector.props.accessibilityLabel).toBe('Muscle overlay: Wireframe');
    expect(StyleSheet.flatten(selector.props.style).maxWidth).toBeUndefined();
    const label = selector.findByType(Text);
    expect(label.props.children).toBe('Wireframe');
    expect(label.props.numberOfLines).toBeUndefined();
    fireEvent.press(selector);
    expect(view.getByTestId('stats-muscle-body-overlay-toggle')).toHaveTextContent('Patches');
    fireEvent.press(view.getByTestId('stats-muscle-body-overlay-toggle'));
    expect(view.getByTestId('stats-muscle-body-overlay-toggle')).toHaveTextContent('Wireframe');
  } finally { act(() => Dimensions.set({ window: original })); }
});
