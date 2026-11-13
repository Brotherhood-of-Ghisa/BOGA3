import { createMuscleWireframeRenderer, colourVector } from '@/components/stats/muscle-wireframe-renderer';
import { generateRoles } from '@/components/ui/theme';
import { hexToLch } from '@/components/ui/lch';
import { themePresets } from '@/components/ui/theme-presets';
import { buildMuscleShadeRamp, buildThemeShadePalette } from '@/components/stats/muscle-body-projection';
import { BODY_WIRE_INSTANCES, MUSCLE_COVER_INSTANCES, MUSCLE_COVER_OPACITY, selectMuscleMeshes, wireframeVertices } from '@/components/stats/muscle-wireframe-scene';
import { recordingGL, wireframeFixture } from './helpers/muscle-wireframe';

it.each(['wireframe', 'contour'] as const)('attenuates straight highlight alpha through every closer muscle layer in %s', overlay => {
  const { context, gl, calls } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  renderer.draw(wireframeFixture({ overlay }));
  expect(gl.clearColor.mock.calls[0][3]).toBe(1);
  expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
  const attenuation = calls.findIndex(c => c.name === 'blendFuncSeparate' && c.args[0] === gl.ZERO);
  const before = calls.slice(0, attenuation);
  expect(before.filter(c => c.name === 'disable' && c.args[0] === gl.BLEND)).toHaveLength(2);
  expect(before.at(-1)).toEqual({ name: 'colorMask', args: [false, false, false, true] });
  expect(before.filter(c => c.name === 'depthMask').at(-1)).toEqual({ name: 'depthMask', args: [false] });
  expect(before).toContainEqual({ name: 'depthFunc', args: [gl.LESS] });
  expect(calls[attenuation]).toEqual({ name: 'blendFuncSeparate', args: [gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA] });
  expect(gl.uniform1f).toHaveBeenCalledWith('fillAlpha', MUSCLE_COVER_OPACITY);
  const coverCount = wireframeVertices(MUSCLE_COVER_INSTANCES).length / 9;
  expect(calls.slice(attenuation)).toContainEqual({ name: 'drawArrays', args: [gl.TRIANGLES, 0, coverCount] });
  expect(gl.blendFuncSeparate).toHaveBeenLastCalledWith(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.TRIANGLE_STRIP, 0, 4);
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
  expect(gl.deleteProgram).toHaveBeenCalledTimes(gl.createProgram.mock.calls.length);
  expect(gl.endFrameEXP).toHaveBeenCalledTimes(4);
});

it('shares selection and covering geometry, camera and target between wires and filled patches', () => {
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

it('composites only inside muscular body regions and clears the stencil for each new frame', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw(frame);
  expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  expect(gl.stencilFunc).toHaveBeenCalledWith(gl.ALWAYS, 0, 0xff);
  expect(gl.stencilFunc).toHaveBeenCalledWith(gl.ALWAYS, 1, 0xff);
  expect(gl.stencilFunc).toHaveBeenLastCalledWith(gl.EQUAL, 1, 0xff);
  gl.stencilMask.mockClear(); gl.clear.mockClear(); gl.bindFramebuffer.mockClear();
  renderer.draw({ ...frame, selected: [] });
  expect(gl.stencilMask.mock.calls[0]).toEqual([0xff]);
  expect(gl.clear).toHaveBeenCalledTimes(1);
  expect(gl.bindFramebuffer).toHaveBeenCalledTimes(1);
  expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
  renderer.dispose();
});

it('reuses the opacity target, resizes it with the drawing buffer, and rejects incomplete targets', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw(frame); renderer.draw(frame);
  expect(gl.texImage2D).toHaveBeenCalledTimes(1);
  gl.drawingBufferWidth = 800; renderer.draw(frame);
  expect(gl.texImage2D).toHaveBeenLastCalledWith(gl.TEXTURE_2D, 0, gl.RGBA, 800, 840, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.drawingBufferHeight = 900; gl.checkFramebufferStatus.mockReturnValue(0);
  expect(() => renderer.draw(frame)).toThrow('Muscle opacity target is incomplete');
  renderer.dispose(); renderer.dispose();
  expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
  expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(1);
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
  expect(gl.clearColor.mock.calls.at(-2)).toEqual([...colourVector(roles.surface), 1]);
  expect(gl.clearColor).toHaveBeenLastCalledWith(0, 0, 0, 0);
  renderer.dispose();
});

it('ignores an unusable viewport without drawing', () => {
  const { context, gl } = recordingGL(); const renderer = createMuscleWireframeRenderer(context);
  const frame = wireframeFixture(); renderer.draw({ ...frame, camera: { ...frame.camera, width: 0 } });
  expect(gl.endFrameEXP).not.toHaveBeenCalled(); renderer.dispose();
});

it.each(['shader', 'link', 'buffer', 'texture', 'framebuffer', 'renderbuffer'])('cleans partial resources on %s creation failure', failure => {
  const { context, gl } = recordingGL();
  if (failure === 'shader') gl.getShaderParameter.mockReturnValue(false);
  if (failure === 'link') gl.getProgramParameter.mockReturnValue(false);
  if (failure === 'buffer') gl.createBuffer.mockImplementationOnce(() => ({ id: 99 })).mockReturnValueOnce(null as never);
  if (failure === 'texture') gl.createTexture.mockReturnValueOnce(null as never);
  if (failure === 'framebuffer') gl.createFramebuffer.mockReturnValueOnce(null as never);
  if (failure === 'renderbuffer') gl.createRenderbuffer.mockReturnValueOnce(null as never);
  expect(() => createMuscleWireframeRenderer(context)).toThrow();
  expect(gl.deleteProgram).toHaveBeenCalledTimes(gl.createProgram.mock.calls.length);
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
