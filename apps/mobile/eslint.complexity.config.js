// Complexity limits for shipped source (`app/**`, `components/**`, `src/**`;
// tests excluded). Run with `npm run lint:complexity` (lane `complexity`).
//
// Kept out of `npm run lint` on purpose: this is a run-once-before-the-PR
// check, not a CI gate. The limits are deliberately lenient, and every
// function that already broke them is grandfathered in
// `eslint-complexity-suppressions.json` (ESLint bulk suppressions, counted per
// file and rule). A new offender, or one more offender in a suppressed file,
// fails the run.
//
// Fixing a grandfathered offender: run
//   npm run lint:complexity -- --prune-suppressions
// so the suppression count goes down with it. Never grow the suppressions
// file to get a new function past the limit: split the function instead.
const sonarjs = require('eslint-plugin-sonarjs');
const base = require('./eslint.config.js');

module.exports = [
  ...base,
  { ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}'] },
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      // Cyclomatic complexity: independent paths through a function.
      complexity: ['error', { max: 20 }],
      // Cognitive complexity: how hard the control flow is to read (nesting
      // costs more than a flat sequence of branches).
      'sonarjs/cognitive-complexity': ['error', 25],
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
    },
  },
];
