import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/test/**/*.test.ts'],
    reporters: ['verbose'],
    testTimeout: 20000,
    // Node 26 can terminate Vitest's fork worker before results are reported.
    // A single worker thread keeps libsql's shared module-level engine isolated
    // while remaining compatible with current and LTS Node releases.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } }
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
