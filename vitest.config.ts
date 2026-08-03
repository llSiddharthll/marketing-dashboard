import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Node environment: the Phase 1 suite covers the server data layer and
    // pure client logic, neither of which needs a DOM.
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    // Excludes the shared fake-transport helper, which is not a test file.
    exclude: ['**/node_modules/**', '**/fakeTransport.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
