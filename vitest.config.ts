import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Windows DPAPI/ACL/media tests start real OS helpers. Bounded workers
    // prevent CPU-count-sized pools from starving their unchanged deadlines.
    ...(process.platform === 'win32' ? { minWorkers: 1, maxWorkers: 4 } : {}),
  },
})
