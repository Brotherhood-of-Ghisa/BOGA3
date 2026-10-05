import { transformSync, type TransformCaller } from '@babel/core';
import { readFileSync } from 'fs';
import path from 'path';

const APP_ROOT = path.join(__dirname, '..', '..');

/**
 * Loads an app module as the device bundle runs it: through the React
 * Compiler (`experiments.reactCompiler` in app.config.ts). Jest's own transform
 * leaves the compiler out, so a hook that reads a non-reactive value during
 * render can pass here and freeze on device. Imports resolve through Jest's
 * registry, so the compiled copy shares module state with the rest of the test.
 */
export function requireWithReactCompiler<T>(relativePath: string): T {
  const filename = path.join(APP_ROOT, relativePath);
  const caller = { name: 'metro', platform: 'ios', supportsReactCompiler: true, isDev: true, bundler: 'metro' };
  const result = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [['babel-preset-expo', { 'react-compiler': {} }]],
    caller: caller as TransformCaller,
  });
  if (!result?.code?.includes('compiler-runtime')) {
    throw new Error(`The React Compiler did not compile ${relativePath}.`);
  }
  const compiled = { exports: {} as T };
  // Evaluate the compiled module with Jest's require.
  new Function('exports', 'require', 'module', result.code)(compiled.exports, require, compiled);
  return compiled.exports;
}
