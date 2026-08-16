import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Mirror the "@/*" -> "./src/*" alias from tsconfig.json. Without this, any
  // module that imports via "@/..." cannot be unit tested at all — which is
  // most of src/lib, including the sync engine.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Only look for Vitest unit tests in src/tests/
    include: ['src/tests/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}'],
    // Exclude Playwright e2e test directory to avoid conflicts
    exclude: ['tests/**', 'node_modules/**'],
    environment: 'node',
  },
});
