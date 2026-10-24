import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

// Unit and integration tests run on plain Node (no Hydrogen or Oxygen plugins).
// Component tests opt in to a DOM with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  resolve: {
    alias: {'~': fileURLToPath(new URL('./app', import.meta.url))},
  },
  test: {
    include: [
      'app/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    // The suite is large and runs its files in parallel: a test that is quick alone can pass 5 s under full load, which
    // made two unrelated tests flake (limiter flood, LazyPanel focus). A generous ceiling is not a retry: a hang still fails.
    testTimeout: 20000,
    // Eight workers on an eight-core machine starve timing-sensitive jsdom tests (a different one failed on each full run);
    // four workers pass every run at the cost of about a minute (measured: 174 s for 5829 tests).
    maxWorkers: 4,
    hookTimeout: 20000,
    // Hydrogen's CartForm calls react-router's hooks; left external it loads a second copy of react-router and
    // cannot see the test's data router (B-20 tests). Processing it here makes both share one copy.
    server: {deps: {inline: ['@shopify/hydrogen']}},
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['app/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.generated.*'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
