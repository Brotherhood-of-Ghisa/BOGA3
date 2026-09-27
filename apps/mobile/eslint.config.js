// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

const NO_DEV_GLOBAL_MESSAGE =
  'Do not use `__DEV__` directly. Use `isDevMode()` from `@/src/utils/isDevMode` instead — it also returns true in the `com.phano.boga3.dev` build (TestFlight dev), where `__DEV__` is false.';

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
    // eslint-plugin-react-hooks 7 (eslint-config-expo 57) reports every place the
    // React Compiler bails out of optimizing. Bailed-out code still runs as written,
    // so these are warnings until the flagged hooks are reworked.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
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
