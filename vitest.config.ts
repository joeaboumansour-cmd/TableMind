import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only look for Vitest unit tests in src/tests/
    include: ['src/tests/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}'],
    // Exclude Playwright e2e test directory to avoid conflicts
    exclude: ['tests/**', 'node_modules/**'],
    environment: 'node',
  },
});
