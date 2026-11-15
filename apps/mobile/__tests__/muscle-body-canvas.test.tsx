import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MuscleBodyCanvas } from '@/components/stats/muscle-body-canvas';
import { createMuscleWireframeRenderer } from '@/components/stats/muscle-wireframe-renderer';
import { recordingGL, wireframeFixture } from './helpers/muscle-wireframe';

jest.mock('@/components/stats/muscle-wireframe-renderer', () => ({ createMuscleWireframeRenderer: jest.fn() }));
const createRenderer = jest.mocked(createMuscleWireframeRenderer);
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('coalesces updates into one frame, draws the latest props and disposes on unmount', () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const frame = wireframeFixture(), onError = jest.fn();
  const view = render(<MuscleBodyCanvas frame={frame} onError={onError} />);
  fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context);
  const latest = { ...frame, november: true };
  view.rerender(<MuscleBodyCanvas frame={latest} onError={onError} />);
  act(() => { jest.advanceTimersByTime(20); });
  expect(renderer.draw).toHaveBeenCalledTimes(1); expect(renderer.draw).toHaveBeenCalledWith(latest);
  view.unmount(); expect(renderer.dispose).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
});

it('schedules again after StrictMode effect replay and ignores late native contexts after unmount', () => {
  const renderer = { draw: jest.fn(), dispose: jest.fn() }; createRenderer.mockReturnValue(renderer);
  const view = render(<StrictMode><MuscleBodyCanvas frame={wireframeFixture()} onError={jest.fn()} /></StrictMode>);
  const onContextCreate = view.getByTestId('stats-muscle-body-wireframe').props.onContextCreate;
  act(() => { onContextCreate(recordingGL().context); jest.advanceTimersByTime(20); });
  expect(renderer.draw).toHaveBeenCalledTimes(1);
  view.unmount(); onContextCreate(recordingGL().context);
  expect(createRenderer).toHaveBeenCalledTimes(1); expect(renderer.dispose).toHaveBeenCalledTimes(1);
});

it.each(['create', 'draw'])('reports %s failure and releases failed drawing resources', failure => {
  const onError = jest.fn(), renderer = { draw: jest.fn(), dispose: jest.fn() };
  if (failure === 'create') createRenderer.mockImplementation(() => { throw new Error('context unavailable'); });
  else { renderer.draw.mockImplementation(() => { throw new Error('lost context'); }); createRenderer.mockReturnValue(renderer); }
  const view = render(<MuscleBodyCanvas frame={wireframeFixture()} onError={onError} />);
  act(() => { fireEvent(view.getByTestId('stats-muscle-body-wireframe'), 'contextCreate', recordingGL().context); jest.advanceTimersByTime(20); });
  expect(onError).toHaveBeenCalledTimes(1);
  if (failure === 'draw') expect(renderer.dispose).toHaveBeenCalledTimes(1);
  view.unmount();
});
