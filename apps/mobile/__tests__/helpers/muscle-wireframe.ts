import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { selectMuscleMeshes, wireframeCamera } from '@/components/stats/muscle-wireframe-scene';
import type { WireframeFrame } from '@/components/stats/muscle-wireframe-renderer';
import { testPalette, testRoles } from './muscle-body-palette';

export function wireframeFixture(overrides: Partial<WireframeFrame> = {}): WireframeFrame {
  const selected = overrides.selected ?? selectMuscleMeshes('brachialis');
  return { selected, camera: wireframeCamera({ angle: 0, width: 280, height: 420, selected, focus: false }),
    scores: new Map([['chest', .5]]), palette: testPalette, roles: testRoles, november: false, ...overrides };
}

export function recordingGL() {
  let id = 0;
  const calls: { name: string; args: unknown[] }[] = [];
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4,
    COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256, DEPTH_TEST: 2929, LEQUAL: 515,
    CULL_FACE: 2884, BACK: 1029, BLEND: 3042, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, ONE: 1,
    drawingBufferWidth: 560, drawingBufferHeight: 840,
    createShader: jest.fn(() => ({ id: ++id })), createProgram: jest.fn(() => ({ id: ++id })),
    createBuffer: jest.fn(() => ({ id: ++id })),
    getShaderParameter: jest.fn(() => true), getProgramParameter: jest.fn(() => true),
    getShaderInfoLog: jest.fn(() => 'test compile failure'), getProgramInfoLog: jest.fn(() => 'test link failure'),
    getExtension: jest.fn(() => ({})), getAttribLocation: jest.fn((_p: unknown, name: string) => ['position', 'normal', 'barycentric'].indexOf(name)),
    getUniformLocation: jest.fn((_p: unknown, name: string) => name),
    shaderSource: jest.fn(), compileShader: jest.fn(), attachShader: jest.fn(), linkProgram: jest.fn(),
    deleteShader: jest.fn(), deleteProgram: jest.fn(), deleteBuffer: jest.fn(),
    bindBuffer: jest.fn(), bufferData: jest.fn(), enableVertexAttribArray: jest.fn(), vertexAttribPointer: jest.fn(),
    uniform3fv: jest.fn(), uniform2f: jest.fn(), uniform1f: jest.fn(), drawArrays: jest.fn(),
    viewport: jest.fn(), colorMask: jest.fn(), depthMask: jest.fn(), clearColor: jest.fn(), clear: jest.fn(),
    useProgram: jest.fn(), enable: jest.fn(), depthFunc: jest.fn(), cullFace: jest.fn(), disable: jest.fn(),
    blendFuncSeparate: jest.fn(), flush: jest.fn(), endFrameEXP: jest.fn(),
  };
  for (const [name, mock] of Object.entries(gl)) {
    if (!jest.isMockFunction(mock)) continue;
    const implementation = mock.getMockImplementation();
    mock.mockImplementation((...args: unknown[]) => { calls.push({ name, args }); return implementation?.(...args); });
  }
  return { gl, context: gl as unknown as ExpoWebGLRenderingContext, calls };
}
