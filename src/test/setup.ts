/**
 * Test fixture helpers — each test gets a private libsql DB file in tmpdir,
 * fully bootstrapped, and torn down afterwards.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { closeDatabase, configureDatabase, dbPath } from '@main/db/connection'
import { bootstrapSchema } from '@main/db/bootstrap'

/** Returns a unique sqlite file path under the OS tmpdir. */
export function uniqueDbFile(prefix = 'abusalah_test'): string {
  const dir = join(tmpdir(), 'abusalah_tests')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${prefix}_${randomUUID()}.sqlite3`)
}

/** Configure + bootstrap a fresh DB. Returns its absolute path. */
export async function setupTestDb(): Promise<string> {
  const file = uniqueDbFile()
  await configureDatabase(file)
  await bootstrapSchema()
  return file
}

/** Close the DB and try to remove the file; sidecar -wal / -shm files too. */
export function teardownTestDb(file: string): void {
  closeDatabase()
  for (const suffix of ['', '-wal', '-shm']) {
    const p = file + suffix
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        // file may still be locked on Windows; ignore
      }
    }
  }
}

/** Convenience wrapper: configure → run → teardown. */
export async function withDb<T>(fn: (file: string) => Promise<T>): Promise<T> {
  const file = await setupTestDb()
  try {
    return await fn(file)
  } finally {
    teardownTestDb(file)
  }
}

export { dbPath }
