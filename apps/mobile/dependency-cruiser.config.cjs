// Import-direction rules for shipped source (`app/**`, `components/**`,
// `src/**`; tests excluded). Run with `npm run lint:deps` (lane `dependencies`).
//
// Like the complexity limits, this is a run-once-before-the-PR check, not a CI
// gate. Imports that already broke a rule are grandfathered in
// `dependency-cruiser-known-violations.json`; a new one fails the run.
//
// Fixing a grandfathered import: run
//   npm run lint:deps:prune
// so the baseline shrinks with it. Never add to the baseline to get a new
// import past a rule: move the code it needs to the layer the rule allows.
// The layers are owned by docs/specs/09-project-structure.md.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Modules that import each other, even through type-only imports, cannot be read, tested or changed alone. Move the shared part into a module both can import.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'src-not-to-ui',
      severity: 'error',
      comment:
        'src/** is the non-UI layer: it never imports screens (app/**) or components (components/**). Move the shared type or helper into src/.',
      from: { path: '^src/' },
      to: { path: '^(app|components)/' },
    },
    {
      name: 'data-to-lower-layers-only',
      severity: 'error',
      comment:
        'src/data is persistence. Besides itself it imports only import-free rules (exercise-calculations, exercise-core, bodyweight as-of/entry rules), the write and invalidation signals, and its startup config. Feature logic, hooks and view models import src/data, never the reverse.',
      from: { path: '^src/data/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/data/',
          '^src/exercise-calculations/',
          '^src/exercise-core/',
          '^src/bodyweight/(as-of|weight-entry|invalidation)\\.ts$',
          '^src/exercise-catalog/invalidation\\.ts$',
          '^src/sync/write-nudge\\.ts$',
          '^src/auth/supabase\\.ts$',
          '^src/logging/',
          '^src/utils/',
          '^src/config/',
        ],
      },
    },
    {
      name: 'calculations-are-leaves',
      severity: 'error',
      comment:
        'src/exercise-calculations is the kernel the Edge Functions load by relative path: it imports only itself and the bodyweight as-of rules, never src/data, hooks or UI.',
      from: { path: '^src/exercise-calculations/' },
      to: {
        path: '^(src|components|app)/',
        pathNot: ['^src/exercise-calculations/', '^src/bodyweight/as-of\\.ts$'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)__tests__/|\\.test\\.tsx?$' },
    // Keep type-only imports: they count for cycles and layering.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
  },
};
