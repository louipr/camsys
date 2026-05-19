/**
 * Cross-session registry of running CAM services.
 *
 * One JSON file per service at `~/.cam/run/<name>.json`. Each running
 * process writes its entry on startup and removes it on clean exit;
 * any consumer (cam UI, agents, sibling apps, other camsys commands)
 * reads the directory to discover what's currently running and where.
 *
 * Writes are atomic (tmp file + rename) so concurrent reads never
 * see partial JSON. Stale entries (PID gone) are cleaned by either
 * `camsys cleanup` or the next process's startup sweep — read paths
 * defensively skip entries whose PID no longer exists.
 *
 * The schema is intentionally minimal — name, pid, pgid, ports, started.
 * Extensions go in the optional `meta` field so older readers don't
 * break on schema additions.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolved at every call so HOME-override (used by tests) takes effect. */
export function registryDir(): string {
  return join(homedir(), '.cam', 'run')
}

/** @deprecated Use registryDir() — exported for back-compat with library
 *  consumers that import a constant. Reads HOME at module-load time. */
export const REGISTRY_DIR = registryDir()

export interface Entry {
  /** Display name — used as the registry key (file basename). */
  name: string
  /** PID of the wrapped child (the camsys-spawned process). */
  pid: number
  /** Process group id — used by `camsys kill` to signal the whole tree. */
  pgid: number
  /** Allocated port for the Vite dev server, if any. */
  vitePort?: number
  /** Allocated port for Chrome DevTools Protocol, if any. */
  cdpPort?: number
  /** The command that was wrapped — for diagnostics + the `list` view. */
  cmd: string
  /** Working directory the spawn was invoked from. */
  cwd: string
  /** Unix-ms epoch when camsys spawned the child. */
  started: number
  /** Extension slot. Older readers ignore unknown keys; new fields go here. */
  meta?: Record<string, unknown>
}

function entryPath(name: string): string {
  // Sanitize: names become filenames, so reject anything path-like.
  if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
    throw new Error(`invalid service name (no slashes / dots): ${name}`)
  }
  return join(registryDir(), `${name}.json`)
}

export function ensureRegistryDir(): void {
  mkdirSync(registryDir(), { recursive: true })
}

/** Atomic write: stage in tmp file, rename onto target. POSIX rename is
 *  atomic on the same filesystem, so concurrent readers never see a
 *  half-written file. Same pattern docskit uses for save. */
export function writeEntry(entry: Entry): void {
  ensureRegistryDir()
  const target = entryPath(entry.name)
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(entry, null, 2))
  renameSync(tmp, target)
}

export function readEntry(name: string): Entry | null {
  const p = entryPath(name)
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf-8')
    return JSON.parse(raw) as Entry
  } catch {
    // Malformed entry — treat as missing. The cleanup pass will delete it.
    return null
  }
}

export function deleteEntry(name: string): void {
  const p = entryPath(name)
  try { unlinkSync(p) } catch { /* already gone */ }
}

export function listEntries(): Entry[] {
  const dir = registryDir()
  if (!existsSync(dir)) return []
  const out: Entry[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    if (f.includes('.tmp-')) continue // in-flight write
    const name = f.slice(0, -'.json'.length)
    const e = readEntry(name)
    if (e) out.push(e)
  }
  // Stable order — by start time, oldest first.
  out.sort((a, b) => a.started - b.started)
  return out
}

/** True iff `pid` corresponds to a live process. Uses `kill(pid, 0)` which
 *  doesn't send a signal — it just probes existence + permission. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM means the process exists but we don't have permission — still alive.
    return code === 'EPERM'
  }
}

/** Remove registry entries whose PID is no longer alive. Returns the
 *  names of the entries that were swept. */
export function sweepStale(): string[] {
  const swept: string[] = []
  for (const e of listEntries()) {
    if (!isPidAlive(e.pid)) {
      deleteEntry(e.name)
      swept.push(e.name)
    }
  }
  return swept
}

/**
 * Send a signal to a registered service's process group and drop its
 * registry entry. The single source of truth for "kill a service":
 * the CLI's `camsys kill`, cam's `camsys:kill` IPC handler, and the
 * standalone app's `camsys:kill` handler all call this. Idempotent
 * — if no entry exists, returns `{ entry: null, killed: false }`.
 */
export function killService(
  name: string,
  signal: NodeJS.Signals = 'SIGTERM',
): { entry: Entry | null; killed: boolean } {
  const entry = readEntry(name)
  if (!entry) return { entry: null, killed: false }
  let killed = false
  try {
    // Negative pid sends the signal to the whole process group.
    process.kill(-entry.pgid, signal)
    killed = true
  } catch {
    // Group already gone; we still want to drop the registry entry.
  }
  deleteEntry(name)
  return { entry, killed }
}
