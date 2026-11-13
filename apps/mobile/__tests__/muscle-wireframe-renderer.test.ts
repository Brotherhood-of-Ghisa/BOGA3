import { createMuscleWireframeRenderer, colourVector } from '@/components/stats/muscle-wireframe-renderer';
import { generateRoles } from '@/components/ui/theme';
import { hexToLch } from '@/components/ui/lch';
import { themePresets } from '@/components/ui/theme-presets';
import { buildMuscleShadeRamp, buildThemeShadePalette } from '@/components/stats/muscle-body-projection';
import { BODY_WIRE_INSTANCES, selectMuscleMeshes } from '@/components/stats/muscle-wireframe-scene';
import { recordingGL, wireframeFixture } from './helpers/muscle-wireframe';

it('uses an opaque body, a selected-depth prepass and separate alpha blending', () => {
  const { context, gl, calls } = recordingGL();
  const renderer = createMuscleWireframeRenderer(context);
  renderer.draw(wireframeFixture());
  expect(gl.clearColor.mock.calls[0][3]).toBe(1);
  const clearDepth = calls.findIndex(call => call.name === 'clear' && call.args[0] === gl.DEPTH_BUFFER_BIT);
  expect(clearDepth).toBeGreaterThan(0);
  const selection = calls.slice(clearDepth);
  expect(selection.findIndex(call => call.name === 'colorMask' && call.args.every(value => value === false)))
    .toBeLessThan(selection.findIndex(call => call.name === 'drawArrays'));
  expect(gl.blendFuncSeparate).toHaveBeenCalledWith(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  expect(gl.uniform1f).toHaveBeenCalledWith('fillAlpha', .18);
  expect(gl.endFrameEXP).toHaveBeenCalledTimes(1);
  renderer.dispose();
});

it('keeps static GPU geometry across rotation and releases replaced selections and all resources once', () => {
  const { context, gl } = recordingGL();
  const renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw(frame);
  const uploads = gl.bufferData.mock.calls.length;
  renderer.draw({ ...frame, camera: { ...frame.camera, cos: 0, sin: 1 } });
  expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
  renderer.draw({ ...frame, selected: selectMuscleMeshes('forearms_grip') });
  expect(gl.bufferData).toHaveBeenCalledTimes(uploads + 1);
  renderer.draw({ ...frame, selected: [] });
  renderer.dispose(); renderer.dispose(); renderer.draw(frame);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(gl.createBuffer.mock.calls.length);
  expect(new Set(gl.deleteBuffer.mock.calls.map(call => call[0])).size).toBe(gl.deleteBuffer.mock.calls.length);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.endFrameEXP).toHaveBeenCalledTimes(4);
});

it('shares selection buffers and camera between coarse wires and opaque filled patches', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw(frame);
  const uploads = gl.bufferData.mock.calls.length;
  gl.uniform1f.mockClear();
  renderer.draw({ ...frame, overlay: 'contour' });
  expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
  expect(gl.uniform1f).toHaveBeenCalledWith('fillAlpha', 1);
  expect(gl.uniform1f.mock.calls.filter(call => call[0] === 'wireWidth').every(call => call[1] === 0)).toBe(true);
  expect(gl.uniform1f).not.toHaveBeenCalledWith('fillAlpha', .18);
  expect(gl.uniform2f).toHaveBeenLastCalledWith('viewport', frame.camera.width, frame.camera.height);
  expect(gl.uniform3fv).toHaveBeenLastCalledWith('wireColour', colourVector(frame.roles.accent));
  renderer.dispose();
});

it('masks covered body wires before drawing them and enables depth writes before clearing selection depth', () => {
  const { context, gl, calls } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  renderer.draw(wireframeFixture());
  const mask = calls.findIndex(c => c.name === 'uniform1f' && c.args[0] === 'reveal' && c.args[1] === 1);
  const firstWire = calls.findIndex(c => c.name === 'uniform1f' && c.args[0] === 'wireWidth' && Number(c.args[1]) > 0);
  expect(mask).toBeGreaterThan(0); expect(mask).toBeLessThan(firstWire);
  const clear = calls.findIndex(c => c.name === 'clear' && c.args[0] === gl.DEPTH_BUFFER_BIT);
  expect(calls[clear-1]).toEqual({ name: 'depthMask', args: [true] });
  renderer.dispose();
});

it('fills patches with the reported activity scale and leaves untracked body regions neutral', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const muscle = { id: 'cm_arm', displayName: 'Arms', familyName: 'Arms', sortOrder: 0 };
  const frame = wireframeFixture({ overlay: 'contour', selected: [], scores: new Map([['cm_arm', .5]]),
    report: new Map([['biceps', { muscle, tracked: true }], ['chest', { muscle, tracked: false }]]) });
  renderer.draw(frame);
  const fills = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').map(call => call[1]);
  expect(fills[BODY_WIRE_INSTANCES.findIndex(m => m.group === 'biceps')]).toEqual(colourVector(buildMuscleShadeRamp(.5, frame.palette)[0]));
  expect(fills[BODY_WIRE_INSTANCES.findIndex(m => m.group === 'chest')]).toEqual(colourVector(frame.palette.neutral[0]));
  renderer.dispose();
});

it('repaints live theme colours without rebuilding geometry and preserves the seasonal decoration', () => {
  const { context, gl } = recordingGL();
  const renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw(frame);
  const uploads = gl.bufferData.mock.calls.length;
  const roles = generateRoles(themePresets[1].seeds, 'dark');
  const palette = buildThemeShadePalette(roles, 'dark');
  renderer.draw({ ...frame, roles, palette, november: true });
  expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
  expect(gl.uniform3fv).toHaveBeenCalledWith('wireColour', colourVector(roles.accent));
  expect(gl.uniform3fv).toHaveBeenCalledWith('fillLow', colourVector(palette.moustache));
  expect(gl.clearColor).toHaveBeenLastCalledWith(...colourVector(roles.surface), 1);
  renderer.dispose();
});

it('ignores an unusable viewport without drawing', () => {
  const { context, gl } = recordingGL(); const renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw({ ...frame, camera: { ...frame.camera, width: 0 } });
  expect(gl.endFrameEXP).not.toHaveBeenCalled(); renderer.dispose();
});

it.each(['shader', 'link', 'buffer'])('cleans partial resources on %s creation failure', failure => {
  const { context, gl } = recordingGL();
  if (failure === 'shader') gl.getShaderParameter.mockReturnValue(false);
  if (failure === 'link') gl.getProgramParameter.mockReturnValue(false);
  if (failure === 'buffer') gl.createBuffer.mockImplementationOnce(() => ({ id: 99 })).mockReturnValueOnce(null as never);
  expect(() => createMuscleWireframeRenderer(context)).toThrow();
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.deleteShader).toHaveBeenCalledTimes(gl.createShader.mock.calls.length);
  if (failure === 'buffer') expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
});

it('colours activity wires by reported scores, keeps untracked regions neutral and the body achromatic', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const muscle = { id: 'cm_arms', displayName: 'Arms', familyName: 'Arms', sortOrder: 0 };
  const frame = wireframeFixture({ selected: [], scores: new Map([['cm_arms', .5], ['chest', 1], ['calves', Infinity], ['quads', NaN], ['back_lats', -Infinity]]),
    report: new Map([['biceps', { muscle, tracked: true }], ['triceps', { muscle, tracked: true }], ['chest', { muscle, tracked: false }]]) });
  renderer.draw(frame);
  const wires = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour').map(call => call[1]);
  const colourOf = (id: string) => wires[BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === id)];
  expect(colourOf('biceps')).toEqual(colourOf('triceps'));
  expect(colourOf('biceps')).not.toEqual(colourOf('neutral'));
  for (const id of ['chest', 'calves', 'quads', 'back_lats', 'forearms_grip']) {
    expect(colourOf(id)).toEqual(colourOf('neutral'));
  }
  for (const [name, vector] of gl.uniform3fv.mock.calls) if (name === 'fillLow' || name === 'fillHigh') {
    expect(Math.max(...vector) - Math.min(...vector)).toBeLessThanOrEqual(1 / 255);
  }
  renderer.dispose();
});

const lightnessOf = (vector: readonly number[]) => hexToLch(
  `#${vector.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`,
).lightness;

it.each(themePresets.flatMap(preset => (['light', 'dark'] as const).map(mode => ({
  name: preset.id, seeds: preset.seeds, mode,
}))))('keeps neutral wires quieter than distinct activity grades in $name / $mode', ({ seeds, mode }) => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const roles = generateRoles(seeds, mode);
  const muscleIds = ['chest', 'biceps', 'quads', 'calves', 'back_lats'];
  const scores = new Map(muscleIds.map((id, index) => [id, index / 2 - 1]));
  const frame = wireframeFixture({ selected: [], roles, palette: buildThemeShadePalette(roles, mode), scores });
  renderer.draw(frame);
  const wires = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour').map(call => call[1]);
  const direction = mode === 'dark' ? 1 : -1;
  const strengthOf = (id: string) => direction * lightnessOf(wires[BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === id)]);
  const grades = ['neutral', ...muscleIds].map(strengthOf);
  for (let index = 1; index < grades.length; index++) {
    expect(grades[index] - grades[index - 1]).toBeGreaterThan(6);
  }
  const fills = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow' || call[0] === 'fillHigh');
  for (const [, vector] of fills) {
    expect(grades[0] - direction * lightnessOf(vector)).toBeGreaterThan(0);
    expect(Math.max(...vector) - Math.min(...vector)).toBeLessThanOrEqual(1 / 255);
  }
  gl.uniform3fv.mockClear();
  renderer.draw({ ...frame, scores: new Map() });
  expect(gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow' || call[0] === 'fillHigh')).toEqual(fills);
  renderer.dispose();
});
