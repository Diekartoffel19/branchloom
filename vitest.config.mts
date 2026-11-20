import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // PowerShell/Git subprocess tests can outlive Vitest's 5 s default on
    // busy Windows laptops. Keep worker pressure bounded for native modules.
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
