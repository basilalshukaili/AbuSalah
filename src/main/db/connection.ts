import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import * as schema from './schema'

let _db: LibSQLDatabase<typeof schema> | null = null
let _client: Client | null = null
let _path: string | null = null

export async function configureDatabase(path: string): Promise<void> {
  if (_client) {
    _client.close()
    _client = null
    _db = null
  }
  _path = path
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // libsql uses file: URLs
  _client = createClient({ url: `file:${path.replace(/\\/g, '/')}` })
  _db = drizzle(_client, { schema })
  // PRAGMAs
  await _client.execute('PRAGMA journal_mode = WAL')
  await _client.execute('PRAGMA foreign_keys = ON')
  await _client.execute('PRAGMA synchronous = NORMAL')
}

export function db(): LibSQLDatabase<typeof schema> {
  if (!_db) throw new Error('Database not configured. Call configureDatabase(path) first.')
  return _db
}

export function rawClient(): Client {
  if (!_client) throw new Error('Database not configured.')
  return _client
}

export function dbPath(): string {
  if (!_path) throw new Error('Database not configured.')
  return _path
}

export function closeDatabase(): void {
  if (_client) {
    _client.close()
    _client = null
    _db = null
  }
}

/**
 * Flush the WAL into the main database file so a file-copy backup captures every
 * committed transaction. Best-effort: a failed checkpoint must never block a
 * backup from being taken.
 */
export async function checkpointWal(): Promise<void> {
  if (!_client) return
  try {
    await _client.execute('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // best-effort
  }
}

export function defaultDbPath(userDataDir: string): string {
  return join(userDataDir, 'data', 'abusalah.sqlite3')
}
