import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { hexToLch, lchToHex } from '@/components/ui/lch';
import type { UiRoles } from '@/components/ui/theme';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { MuscleBodyMaterialId } from './muscle-body-mesh';
import { NOVEMBER_MOUSTACHE_MESH } from './muscle-body-moustache';
import { buildMuscleShadeRamp, reportedMaterial, type MuscleOverlayStyle, type ThemeShadePalette } from './muscle-body-projection';
import { BODY_WIRE_INSTANCES, MUSCLE_COVER_INSTANCES, MUSCLE_COVER_OPACITY, wireframeVertices, type AnatomyInstance, type WireframeCamera } from './muscle-wireframe-scene';

export type WireframeFrame = {
  readonly overlay: MuscleOverlayStyle;
  readonly camera: WireframeCamera;
  readonly selected: readonly AnatomyInstance[];
  readonly scores: ReadonlyMap<string, number | null>;
  readonly report?: MuscleReportAssignment;
  readonly palette: ThemeShadePalette;
  readonly roles: UiRoles;
  readonly november: boolean;
};

const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 barycentric;
uniform vec2 rotation;
uniform vec2 centre;
uniform vec2 viewport;
uniform float scale;
varying vec3 bary;
varying float lighting;
void main() {
  vec3 p = vec3(position.x*rotation.x+position.z*rotation.y, position.y, -position.x*rotation.y+position.z*rotation.x);
  vec3 n = vec3(normal.x*rotation.x+normal.z*rotation.y, normal.y, -normal.x*rotation.y+normal.z*rotation.x);
  gl_Position=vec4((p.xy-centre)*scale*2.0/viewport, -p.z/2.0, 1.0);
  lighting=clamp(.25+.60*max(0.0,dot(n,vec3(.34,.52,.78)))+.12*max(0.0,dot(n,vec3(-.48,-.28,.42))),0.0,1.0);
  bary=barycentric;
}`;
const FRAGMENT_SHADER = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 bary;
varying float lighting;
uniform vec3 fillLow;
uniform vec3 fillHigh;
uniform vec3 wireColour;
uniform float fillAlpha;
uniform float wireWidth;
void main() {
  vec3 a=smoothstep(vec3(0.0),fwidth(bary)*max(wireWidth,.001),bary);
  float edge=wireWidth>0.0 ? 1.0-min(min(a.x,a.y),a.z) : 0.0;
  gl_FragColor=vec4(mix(mix(fillLow,fillHigh,lighting),wireColour,edge),mix(fillAlpha,1.0,edge));
}`;

export const colourVector = (hex: string): readonly number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

function compileShader(gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate a muscle shader');
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message ?? 'Muscle shader compilation failed');
  }
  return shader;
}

function createProgram(gl: ExpoWebGLRenderingContext, vertex = VERTEX_SHADER, fragment = FRAGMENT_SHADER): WebGLProgram {
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate the muscle renderer');
  try {
    shaders.push(compileShader(gl, gl.VERTEX_SHADER, vertex));
    shaders.push(compileShader(gl, gl.FRAGMENT_SHADER, fragment));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Muscle shader link failed');
    return program;
  } catch (error) { gl.deleteProgram(program); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

const OVERLAY_VERTEX_SHADER = `
attribute vec2 corner;
varying vec2 uv;
void main() { uv=corner*.5+.5; gl_Position=vec4(corner,0.0,1.0); }
`;
const OVERLAY_FRAGMENT_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D overlay;
void main() { gl_FragColor=texture2D(overlay,uv); }
`;

/** Straight RGBA keeps highlight colour unchanged as covering surfaces reduce only its opacity. */
function createOverlayTarget(gl: ExpoWebGLRenderingContext) {
  const program = createProgram(gl, OVERLAY_VERTEX_SHADER, OVERLAY_FRAGMENT_SHADER);
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(), depth = gl.createRenderbuffer(), corners = gl.createBuffer();
  const dispose = () => {
    gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(depth); gl.deleteBuffer(corners); gl.deleteProgram(program);
  };
  if (!texture || !framebuffer || !depth || !corners) { dispose(); throw new Error('Unable to allocate muscle opacity target'); }
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const corner = gl.getAttribLocation(program, 'corner'), sampler = gl.getUniformLocation(program, 'overlay');
  let width = 0, height = 0;
  return {
    dispose,
    begin() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (width === gl.drawingBufferWidth && height === gl.drawingBufferHeight) return;
      const nextWidth = gl.drawingBufferWidth, nextHeight = gl.drawingBufferHeight;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nextWidth, nextHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, nextWidth, nextHeight);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Muscle opacity target is incomplete');
      width = nextWidth; height = nextHeight;
    },
    composite() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(sampler, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.STENCIL_TEST); gl.stencilMask(0); gl.stencilFunc(gl.EQUAL, 1, 0xff);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

type MeshBuffer = { readonly buffer: WebGLBuffer; readonly count: number; readonly group: string };
export type MuscleWireframeRenderer = { draw(frame: WireframeFrame): void; dispose(): void };

function frameColours(frame: WireframeFrame) {
  const paper = hexToLch(frame.roles.paper).lightness, ink = hexToLch(frame.roles.ink).lightness;
  const dark = paper < ink;
  const grey = (amount: number) => lchToHex({ lightness: paper + (ink - paper) * amount, chroma: 0, hue: 0 });
  const ramps = BODY_WIRE_INSTANCES.map(mesh => {
    const reported = reportedMaterial(mesh.group as MuscleBodyMaterialId, frame.report);
    return buildMuscleShadeRamp(reported === 'neutral' ? null : frame.scores.get(reported) ?? null, frame.palette);
  });
  return {
    low: grey(.08), high: grey(dark ? .14 : .03),
    body: BODY_WIRE_INSTANCES.map(mesh => {
      const reported = reportedMaterial(mesh.group as MuscleBodyMaterialId, frame.report);
      const score = frame.scores.get(reported) ?? null;
      if (reported === 'neutral' || score === null || !Number.isFinite(score)) return grey(.20);
      const colour = hexToLch(buildMuscleShadeRamp(score, frame.palette)[6]);
      const grade = Math.max(0, Math.min(1, (score + 1) / 2));
      // Thin wires need a wider contrast range than patches, clear of the neutral body shading.
      return lchToHex({ ...colour, lightness: paper + (ink - paper) * (.38 + .44 * grade) });
    }),
    ramps,
  };
}

export function createMuscleWireframeRenderer(gl: ExpoWebGLRenderingContext): MuscleWireframeRenderer {
  gl.getExtension('OES_standard_derivatives');
  const program = createProgram(gl);
  const buffers = new Set<WebGLBuffer>();
  const upload = (instances: readonly AnatomyInstance[], group: string): MeshBuffer => {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate muscle geometry');
    buffers.add(buffer);
    const data = wireframeVertices(instances);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 9, group };
  };
  let overlay: ReturnType<typeof createOverlayTarget> | undefined;
  const dispose = () => { overlay?.dispose(); for (const buffer of buffers) gl.deleteBuffer(buffer); buffers.clear(); gl.deleteProgram(program); };
  let body: MeshBuffer[], moustache: MeshBuffer, cover: MeshBuffer;
  try {
    body = BODY_WIRE_INSTANCES.map(instance => upload([instance], instance.group));
    cover = upload(MUSCLE_COVER_INSTANCES, 'cover');
    overlay = createOverlayTarget(gl);
    moustache = upload([{ part: { id: 'moustache', vertices: NOVEMBER_MOUSTACHE_MESH.vertices, faces: NOVEMBER_MOUSTACHE_MESH.faces }, group: 'neutral', side: 1 }], 'moustache');
  } catch (error) { dispose(); throw error; }
  const attributes = ['position', 'normal', 'barycentric'].map(name => gl.getAttribLocation(program, name));
  const uniforms = Object.fromEntries(['rotation', 'centre', 'viewport', 'scale', 'fillLow', 'fillHigh', 'wireColour', 'fillAlpha', 'wireWidth'].map(name => [name, gl.getUniformLocation(program, name)]));
  const colour = (name: string, hex: string) => gl.uniform3fv(uniforms[name], colourVector(hex));
  const paint = (mesh: MeshBuffer) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    attributes.forEach((attribute, i) => { gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 36, i * 12); });
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  };
  let selection: MeshBuffer | null = null, previousSelection: readonly AnatomyInstance[] | null = null, disposed = false;
  let previousStyle: WireframeFrame | null = null;
  let colours: ReturnType<typeof frameColours>;
  return {
    dispose() { if (!disposed) { disposed = true; dispose(); } },
    draw(frame) {
      if (disposed || frame.camera.width <= 0 || frame.camera.height <= 0) return;
      const { camera, selected, roles, palette } = frame;
      const wires = frame.overlay === 'wireframe';
      if (!previousStyle || ['roles', 'palette', 'scores', 'report', 'selected'].some(key => frame[key as keyof WireframeFrame] !== previousStyle?.[key as keyof WireframeFrame])) {
        colours = frameColours(frame); previousStyle = frame;
      }
      if (previousSelection !== selected) {
        if (selection) { gl.deleteBuffer(selection.buffer); buffers.delete(selection.buffer); }
        selection = selected.length ? upload(selected, 'selection') : null; previousSelection = selected;
      }
      const ratio = gl.drawingBufferWidth / camera.width;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.colorMask(true, true, true, true); gl.depthMask(true);
      const ground = { backgroundColor: roles.surface };
      const background = colourVector(ground.backgroundColor); gl.clearColor(background[0], background[1], background[2], 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xff); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT); gl.useProgram(program);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
      gl.uniform2f(uniforms.rotation, camera.cos, camera.sin); gl.uniform2f(uniforms.centre, camera.centreX, camera.centreY);
      gl.uniform2f(uniforms.viewport, camera.width, camera.height); gl.uniform1f(uniforms.scale, camera.scale);
      gl.uniform1f(uniforms.fillAlpha, 1); gl.uniform1f(uniforms.wireWidth, 0);
      body.forEach((mesh, i) => {
        const ramp = colours.ramps[i];
        gl.stencilFunc(gl.ALWAYS, mesh.group === 'neutral' ? 0 : 1, 0xff);
        colour('fillLow', wires ? colours.low : ramp[0]); colour('fillHigh', wires ? colours.high : ramp[ramp.length - 1]);
        paint(mesh);
      });
      if (frame.november) {
        gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        colour('fillLow', palette.moustache); colour('fillHigh', palette.moustache); colour('wireColour', palette.moustache); paint(moustache);
      }
      gl.stencilMask(0);
      if (wires) {
        gl.depthMask(false); gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(uniforms.fillAlpha, 0); gl.uniform1f(uniforms.wireWidth, .65 * ratio);
        body.forEach((mesh, i) => { colour('wireColour', colours.body[i]); paint(mesh); });
      }
      if (selection) {
        overlay!.begin(); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // Resolve only the selected surfaces, then write straight RGBA for their nearest visible detail.
        gl.colorMask(false, false, false, false); paint(selection);
        gl.colorMask(true, true, true, true); gl.depthMask(false);
        colour('fillLow', roles.accent); colour('fillHigh', roles.accent); colour('wireColour', roles.accent);
        gl.uniform1f(uniforms.fillAlpha, wires ? .18 : 1); gl.uniform1f(uniforms.wireWidth, wires ? 1.05 * ratio : 0); paint(selection);
        // Each closer muscle surface transmits half the remaining highlight; surfaces behind it do nothing.
        gl.depthFunc(gl.LESS); gl.enable(gl.BLEND); gl.colorMask(false, false, false, true);
        gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(uniforms.fillAlpha, MUSCLE_COVER_OPACITY); gl.uniform1f(uniforms.wireWidth, 0); paint(cover);
        gl.colorMask(true, true, true, true); overlay!.composite();
      }
      gl.disable(gl.STENCIL_TEST); gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.flush(); gl.endFrameEXP();
    },
  };
}
