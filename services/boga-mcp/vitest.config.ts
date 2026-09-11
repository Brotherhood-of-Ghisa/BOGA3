import { defineConfig } from 'vitest/config';

// vitest >= 4 no longer excludes dist/ by default; without this it also runs
// the compiled dist/test/*.test.js left behind by `npm run build`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
