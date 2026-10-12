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
