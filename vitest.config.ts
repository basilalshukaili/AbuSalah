import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/test/**/*.test.ts'],
    reporters: ['verbose'],
    testTimeout: 20000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } } // libsql + shared module-level engine
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
