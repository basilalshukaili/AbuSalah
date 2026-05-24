import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { dbPath } from '../db/connection'

/**
 * Best-effort delete of WAL/SHM sidecar files. After a backup is restored
 * with copyFileSync, leaving the old `-wal` and `-shm` files in place would
 * cause libsql to replay the old WAL on top of the freshly-copied main DB
 * the next time it opens — silently destroying the restore.
 */
function removeWalSidecars(mainDbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const f = mainDbPath + suffix
    if (existsSync(f)) {
      try {
        unlinkSync(f)
      } catch {
        // best-effort
      }
    }
  }
}

export function ensureBackupDir(backupDir: string): void {
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
}

export function createBackup(backupDir: string, label = ''): string {
  ensureBackupDir(backupDir)
  // Millisecond-precision timestamp avoids collisions in rapid successive backups.
  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, '')
    .slice(0, 17) // YYYYMMDDHHmmssSSS
  const suffix = label ? `_${label}` : ''
  const target = join(backupDir, `abusalah_${timestamp}${suffix}.sqlite3`)
  const src = dbPath()
  if (!existsSync(src)) throw new Error(`database file missing: ${src}`)
  copyFileSync(src, target)
  return target
}

export interface BackupListing {
  path: string
  size: number
  mtime: string
}

export function listBackups(backupDir: string): BackupListing[] {
  if (!existsSync(backupDir)) return []
  const entries = readdirSync(backupDir).filter((f) => f.startsWith('abusalah_') && f.endsWith('.sqlite3'))
  return entries
    .map((f) => {
      const full = join(backupDir, f)
      const st = statSync(full)
      return { path: full, size: st.size, mtime: st.mtime.toISOString() }
    })
    .sort((a, b) => (a.mtime > b.mtime ? -1 : 1))
}

export function restoreBackup(backupPath: string, backupDir: string): void {
  if (!existsSync(backupPath)) throw new Error(`backup file missing: ${backupPath}`)
  // Snapshot current first — only swallow the "no live DB yet" case.
  if (existsSync(dbPath())) {
    createBackup(backupDir, 'pre_restore') // propagate any real failure
  }
  copyFileSync(backupPath, dbPath())
  // Important: drop any leftover WAL/SHM so libsql does not replay the old
  // journal on top of the restored main file. Caller must close/reconfigure
  // the DB connection separately (the IPC handler does this).
  removeWalSidecars(dbPath())
}

export function cleanupOld(backupDir: string, keepDays: number): number {
  if (keepDays <= 0) return 0
  const cutoff = Date.now() - keepDays * 86400_000
  let removed = 0
  for (const b of listBackups(backupDir)) {
    if (statSync(b.path).mtime.getTime() < cutoff) {
      try {
        unlinkSync(b.path)
        removed++
      } catch {
        // skip
      }
    }
  }
  return removed
}
