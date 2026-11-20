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
  gl.uniform3fv.mockClear();
  renderer.draw({ ...frame, overlay: 'contour' });
  expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
  expect(gl.uniform1f).toHaveBeenCalledWith('fillAlpha', 1);
  expect(gl.uniform1f.mock.calls.filter(call => call[0] === 'wireWidth').every(call => call[1] === 0)).toBe(true);
  expect(gl.uniform1f).not.toHaveBeenCalledWith('fillAlpha', .18);
  expect(gl.uniform2f).toHaveBeenLastCalledWith('viewport', frame.camera.width, frame.camera.height);
  expect(gl.uniform3fv).toHaveBeenLastCalledWith('wireColour', colourVector(frame.roles.accent));
  const fills = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').map(call => call[1]);
  expect(fills[BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === 'chest')]).toEqual(colourVector(buildMuscleShadeRamp(.5, frame.palette)[0]));
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
  const selectionWire = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour').at(-1)![1];
  expect(Math.max(...selectionWire) - Math.min(...selectionWire)).toBeLessThanOrEqual(1 / 255);
  expect(selectionWire).not.toEqual(colourVector(roles.accent));
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

it('colours translucent faces by reported effort, keeps merged grades together and untracked or invalid regions neutral', () => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const muscle = { id: 'cm_arms', displayName: 'Arms', familyName: 'Arms', sortOrder: 0 };
  const frame = wireframeFixture({ selected: [], scores: new Map([['cm_arms', .5], ['chest', 1], ['calves', Infinity], ['quads', NaN], ['back_lats', -Infinity]]),
    report: new Map([['biceps', { muscle, tracked: true }], ['triceps', { muscle, tracked: true }], ['chest', { muscle, tracked: false }]]) });
  renderer.draw(frame);
  const fills = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').slice(BODY_WIRE_INSTANCES.length).map(call => call[1]);
  const colourOf = (id: string) => fills[BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === id)];
  expect(colourOf('biceps')).toEqual(colourOf('triceps'));
  expect(lightnessOf(colourOf('biceps'))).toBeLessThan(lightnessOf(colourVector(buildMuscleShadeRamp(.5, frame.palette)[0])));
  expect(colourOf('biceps')).not.toEqual(colourOf('neutral'));
  for (const id of ['chest', 'calves', 'quads', 'back_lats', 'forearms_grip']) {
    expect(colourOf(id)).toEqual(colourOf('neutral'));
  }
  expect(colourOf('neutral')).toEqual(colourVector(frame.palette.neutral[0]));
  expect(gl.uniform1f).toHaveBeenCalledWith('fillAlpha', .4);
  const wires = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour');
  expect(wires).toHaveLength(1);
  expect(Math.max(...wires[0][1]) - Math.min(...wires[0][1])).toBeLessThanOrEqual(1 / 255);
  renderer.dispose();
});

const lchOf = (vector: readonly number[]) => hexToLch(
  `#${vector.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`,
);
const lightnessOf = (vector: readonly number[]) => lchOf(vector).lightness;

it('keeps every effort and neutral region on the same thin wire width at the device pixel ratio', () => {
  const { context, gl, calls } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  gl.drawingBufferWidth = 840;
  const muscle = { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 0 };
  const frame = wireframeFixture({ selected: [], scores: new Map([
    ['chest', -1], ['biceps', 0], ['quads', 1], ['triceps', .5],
    ['calves', Infinity], ['back_lats', NaN], ['glutes_max', -Infinity], ['forearms_grip', null],
  ]), report: new Map([['triceps', { muscle, tracked: false }]]) });
  const ratio = gl.drawingBufferWidth / frame.camera.width;
  for (const scores of [frame.scores, new Map()]) {
    calls.length = 0;
    renderer.draw({ ...frame, scores });
    let alpha = 1, width = 0;
    const wireWidths: number[] = [];
    for (const call of calls) {
      if (call.name === 'uniform1f' && call.args[0] === 'fillAlpha') alpha = call.args[1] as number;
      if (call.name === 'uniform1f' && call.args[0] === 'wireWidth') width = call.args[1] as number;
      if (call.name === 'drawArrays' && alpha === .4) wireWidths.push(width);
    }
    expect(wireWidths).toEqual(BODY_WIRE_INSTANCES.map(() => .45 * ratio));
  }
  renderer.dispose();
});

it.each(themePresets.flatMap(preset => (['light', 'dark'] as const).map(mode => ({
  name: preset.id, seeds: preset.seeds, mode,
}))))('keeps translucent effort grades ordered with neutral wires in $name / $mode', ({ seeds, mode }) => {
  const { context, gl } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const roles = generateRoles(seeds, mode);
  const muscleIds = ['chest', 'biceps', 'quads', 'calves', 'back_lats'];
  const scores = new Map(muscleIds.map((id, index) => [id, index / 2 - 1]));
  const frame = wireframeFixture({ selected: [], roles, palette: buildThemeShadePalette(roles, mode), scores });
  renderer.draw(frame);
  const bodyCount = BODY_WIRE_INSTANCES.length;
  const low: readonly (readonly number[])[] = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').map(call => call[1]);
  const high: readonly (readonly number[])[] = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillHigh').map(call => call[1]);
  const base = low[0].map((value, i) => (value + high[0][i]) / 2);
  const direction = mode === 'dark' ? 1 : -1;
  const blendedFace = (id: string) => {
    const index = bodyCount + BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === id);
    return base.map((value, i) => .6 * value + .4 * (low[index][i] + high[index][i]) / 2);
  };
  const grades = ['neutral', ...muscleIds].map(id => direction * lightnessOf(blendedFace(id)));
  for (let index = 1; index < grades.length; index++) {
    expect(grades[index] - grades[index - 1]).toBeGreaterThan(index === 1 ? 8 : 2);
  }
  // The composited surface must retain the data hue rather than washing out to grey.
  expect(lchOf(blendedFace('back_lats')).chroma).toBeGreaterThan(frame.palette.anchors[2].chroma * .45);
  const wires = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour');
  expect(wires).toHaveLength(1);
  expect(wires[0][1]).not.toEqual(colourVector(roles.accent));
  for (const vector of [...low.slice(0, bodyCount), ...high.slice(0, bodyCount), wires[0][1]]) {
    expect(Math.max(...vector) - Math.min(...vector)).toBeLessThanOrEqual(1 / 255);
  }
  gl.uniform3fv.mockClear();
  renderer.draw({ ...frame, scores: new Map() });
  const repainted = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').map(call => call[1]);
  expect(repainted.slice(0, bodyCount)).toEqual(low.slice(0, bodyCount));
  expect(repainted.slice(bodyCount)).toEqual(BODY_WIRE_INSTANCES.map(() => colourVector(frame.palette.neutral[0])));
  for (const id of ['quads', 'back_lats']) {
    gl.uniform3fv.mockClear();
    renderer.draw({ ...frame, selected: selectMuscleMeshes(id) });
    const selectedLow = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillLow').at(-1)![1];
    const selectedHigh = gl.uniform3fv.mock.calls.filter(call => call[0] === 'fillHigh').at(-1)![1];
    const body = blendedFace(id);
    const selected = body.map((channel, i) => .6 * channel + .4 * (selectedLow[i] + selectedHigh[i]) / 2);
    expect(lightnessOf(selected)).toBeCloseTo(lightnessOf(body), 1);
  }
  renderer.dispose();
});

it.each([.5, null, NaN, Infinity])('fills selected anatomical polygons with their reported effort (%s) and thin neutral edges', score => {
  const { context, gl, calls } = recordingGL(), renderer = createMuscleWireframeRenderer(context);
  const muscle = { id: 'cm_chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 };
  const report = new Map([['chest', { muscle, tracked: true }]]);
  const frame = wireframeFixture({ selected: selectMuscleMeshes('cm_chest', report), report,
    scores: new Map([['cm_chest', score]]) });
  renderer.draw(frame);
  const selectionPaint = calls.findIndex(call => call.name === 'uniform1f'
    && call.args[0] === 'wireWidth' && call.args[1] === .55 * gl.drawingBufferWidth / frame.camera.width);
  expect(selectionPaint).toBeGreaterThan(0);
  expect(calls[selectionPaint - 1]).toEqual({ name: 'uniform1f', args: ['fillAlpha', .4] });
  expect(calls[selectionPaint + 1].name).toBe('bindBuffer');
  for (const name of ['fillLow', 'fillHigh']) {
    const fills = gl.uniform3fv.mock.calls.filter(call => call[0] === name).map(call => call[1]);
    const chest = BODY_WIRE_INSTANCES.findIndex(mesh => mesh.group === 'chest');
    const bodyFill: readonly number[] = fills[BODY_WIRE_INSTANCES.length + chest];
    const displayed = bodyFill.map((channel, i) => .4 * channel + .6 * fills[chest][i]);
    expect(fills.at(-1)).toEqual(displayed);
    if (score === .5) expect(lchOf(fills.at(-1)!).chroma).toBeGreaterThan(8);
    else expect(bodyFill).toEqual(colourVector(name === 'fillLow' ? frame.palette.neutral[0] : frame.palette.neutral.at(-1)!));
  }
  const wires = gl.uniform3fv.mock.calls.filter(call => call[0] === 'wireColour').map(call => call[1]);
  expect(wires).toHaveLength(2);
  for (const vector of wires) {
    expect(Math.max(...vector) - Math.min(...vector)).toBeLessThanOrEqual(1 / 255);
    expect(vector).not.toEqual(colourVector(frame.roles.accent));
  }
  expect(lightnessOf(wires[1])).toBeLessThan(lightnessOf(wires[0]));
  renderer.dispose();
});
