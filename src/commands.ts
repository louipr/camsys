/**
 * Read-side commands: list / port / kill / cleanup.
 *
 * Each returns a numeric exit code so the CLI dispatcher can propagate
 * it directly. Stdout / stderr writes are inline — kept simple, no
 * formatter abstraction (one-table-format-fits-all).
 */

import {
  deleteEntry,
  isPidAlive,
  listEntries,
  readEntry,
  sweepStale,
  type Entry,
} from './registry.js'

/** `camsys list` — print the registry as a table. */
export function cmdList(): number {
  const entries = listEntries()
  if (entries.length === 0) {
    console.log('(no services registered)')
    return 0
  }

  // Compute column widths from the data — no fixed magic numbers.
  const rows = entries.map((e) => ({
    name: e.name,
    pid: String(e.pid),
    vite: e.vitePort ? String(e.vitePort) : '-',
    cdp: e.cdpPort ? String(e.cdpPort) : '-',
    age: formatAge(Date.now() - e.started),
    alive: isPidAlive(e.pid) ? '✓' : 'stale',
  }))

  const header = { name: 'NAME', pid: 'PID', vite: 'VITE', cdp: 'CDP', age: 'AGE', alive: '' }
  const all = [header, ...rows]
  const w = {
    name:  Math.max(...all.map((r) => r.name.length)),
    pid:   Math.max(...all.map((r) => r.pid.length)),
    vite:  Math.max(...all.map((r) => r.vite.length)),
    cdp:   Math.max(...all.map((r) => r.cdp.length)),
    age:   Math.max(...all.map((r) => r.age.length)),
  }

  const fmt = (r: typeof header) =>
    `${r.name.padEnd(w.name)}  ${r.pid.padStart(w.pid)}  ${r.vite.padStart(w.vite)}  ${r.cdp.padStart(w.cdp)}  ${r.age.padStart(w.age)}  ${r.alive}`

  console.log(fmt(header))
  for (const r of rows) console.log(fmt(r))
  return 0
}

/** `camsys port <name> [vite|cdp]` — print a registered port number. */
export function cmdPort(name: string, kind: 'vite' | 'cdp' = 'vite'): number {
  const e = readEntry(name)
  if (!e) {
    console.error(`no service named '${name}'`)
    return 1
  }
  const port = kind === 'vite' ? e.vitePort : e.cdpPort
  if (port === undefined) {
    console.error(`service '${name}' has no ${kind} port`)
    return 1
  }
  console.log(port)
  return 0
}

/** `camsys kill <name>` — send SIGTERM to the recorded process group.
 *  Removes the registry entry whether or not the kill succeeded
 *  (a stale entry shouldn't outlive the kill command). */
export function cmdKill(name: string, signal: NodeJS.Signals = 'SIGTERM'): number {
  const e = readEntry(name)
  if (!e) {
    console.error(`no service named '${name}'`)
    return 1
  }
  let killed = false
  try {
    process.kill(-e.pgid, signal)
    killed = true
  } catch {
    // Group already gone — fine, we'll just delete the stale entry.
  }
  deleteEntry(name)
  console.log(`${killed ? 'sent ' + signal + ' to' : 'cleaned stale entry for'} ${name} (pid=${e.pid} pgid=${e.pgid})`)
  return 0
}

/** `camsys cleanup` — sweep stale entries (PID gone). The launchd janitor
 *  handles broader orphan-process cleanup; this command is the registry-
 *  side counterpart that drops zombie file entries. */
export function cmdCleanup(): number {
  const swept = sweepStale()
  if (swept.length === 0) {
    console.log('(no stale entries)')
  } else {
    console.log(`swept ${swept.length} stale ${swept.length === 1 ? 'entry' : 'entries'}: ${swept.join(', ')}`)
  }
  return 0
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

// Re-exports so consumers importing the library face get the data layer too.
export { listEntries, readEntry, type Entry }
