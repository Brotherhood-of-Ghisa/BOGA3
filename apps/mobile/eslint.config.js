// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

const NO_DEV_GLOBAL_MESSAGE =
  'Do not use `__DEV__` directly. Use `isDevMode()` from `@/src/utils/isDevMode` instead — it also returns true in the `com.phano.boga3.dev` build (TestFlight dev), where `__DEV__` is false.';

const WAIT_FOR_ABSENCE_MESSAGE =
  'Wait for an element to leave with `waitForGone(() => screen.queryBy…(…))` from `__tests__/helpers/wait-for-gone.ts`, not `waitFor(() => expect(queryBy…).toBeNull())` (docs/specs/writing-tests.md, "Async waits").';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    settings: {
      'import/core-modules': [
        '@supabase/supabase-js',
        'expo-application',
        'expo-secure-store',
        'react-native-url-polyfill/auto',
      ],
    },
    rules: {
      // `__DEV__` is declared as a `readonly` global by `eslint-config-expo`,
      // so `no-restricted-globals` reliably matches variable reads of it
      // without firing on property keys (`{ __DEV__: ... }`) or non-computed
      // member accesses (`obj.__DEV__`).
      'no-restricted-globals': [
        'error',
        {
          name: '__DEV__',
          message: NO_DEV_GLOBAL_MESSAGE,
        },
      ],
    },
  },
  {
    // A failed absence matcher inside waitFor pretty-prints the element's whole
    // React fiber on every poll, which on a slow runner outlasts the timeout.
    files: ['__tests__/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['callee.object.arguments.0.callee.property.name', 'callee.object.arguments.0.callee.name'].map((query) => ({
          selector: `CallExpression[callee.name='waitFor'] CallExpression[callee.property.name=/^(toBeNull|toBeFalsy|toBeUndefined)$/][callee.object.callee.name='expect'][${query}=/^query/]`,
          message: WAIT_FOR_ABSENCE_MESSAGE,
        })),
      ],
    },
  },
  {
    // Node CLI scripts (CommonJS).
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Maestro `runScript` files run in Maestro's GraalJS, not Node or Metro:
    // plain `var` globals, and `output` / `http` / `json` / `maestro` injected.
    files: ['.maestro/scripts/**/*.js'],
    languageOptions: {
      globals: { output: 'writable', http: 'readonly', json: 'readonly', maestro: 'readonly' },
    },
    rules: {
      'no-var': 'off',
    },
  },
  {
    // The utility itself is the one place where `__DEV__` is legitimate.
    // Use `**/` so the exemption matches regardless of the eslint CWD.
    files: ['**/src/utils/isDevMode.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
]);
