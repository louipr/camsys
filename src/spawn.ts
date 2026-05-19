/**
 * `camsys run` — the wrapper that owns spawn + register + cleanup.
 *
 * Lifecycle:
 *  1. Pick free ports for Vite + CDP via the kernel (bind(0)).
 *  2. Spawn the child in a new process group (detached: true on POSIX)
 *     with CAM_VITE_PORT + CAM_CDP_PORT injected into its env. Stdio
 *     is inherited so the child's output reaches the terminal normally.
 *  3. Write the registry entry to ~/.cam/run/<name>.json.
 *  4. Forward SIGINT / SIGTERM / SIGHUP from this wrapper to the child's
 *     process group — `kill(-pgid, sig)` so the whole subtree (vite +
 *     electron + renderer helpers) goes down together.
 *  5. On child exit (clean or signal-driven), delete the registry entry
 *     and propagate the exit code.
 *
 * What doesn't get cleaned by this wrapper:
 *  - If the wrapper itself is SIGKILL'd (uncatchable), the signal-
 *    forward step is skipped; the child stays alive as an orphan. The
 *    registry entry stays stale until the next `camsys cleanup` or the
 *    periodic launchd janitor sweep. Process-group kill via the janitor
 *    or `camsys kill` still works because the pgid is recorded.
 *  - Children that explicitly `setsid()` escape the process group.
 *    None of the current CAM apps do this; electron-vite + electron +
 *    vite all stay in the inherited group.
 *
 * Two ports are always allocated (vite + cdp). If the wrapped child
 * uses only one, the other env var is just unread — costs nothing and
 * keeps the wrapper's surface uniform. Per-app port-count selection
 * would be a v2 feature (add --no-cdp / --ports flags).
 */

import { spawn } from 'node:child_process'
import { writeEntry, deleteEntry, type Entry } from './registry.js'
import { pickFreePorts } from './ports.js'

export interface RunOptions {
  /** Service name — becomes the registry key + filename. */
  name: string
  /** Argv of the child command, in [cmd, ...args] form. */
  argv: string[]
  /** Working directory for the child. Defaults to process.cwd(). */
  cwd?: string
  /** Extra env vars to inject in addition to CAM_*_PORT. */
  env?: Record<string, string>
  /**
   * Fire-and-forget mode for library callers (e.g., cam's main
   * process spawning docskit from "Open in docskit"). Differences
   * from the default CLI behavior:
   *  - stdio: 'ignore' (no terminal to inherit)
   *  - child.unref() (parent can exit while child keeps running)
   *  - no signal forwarding (parent's SIGTERM doesn't kill the child)
   * The returned promise still resolves when the child exits, and
   * cleanup (deleteEntry) still runs — callers that don't care just
   * `void run({detach: true, ...})` and forget.
   */
  detach?: boolean
}

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

export async function run(opts: RunOptions): Promise<number> {
  if (opts.argv.length === 0) {
    throw new Error('camsys run: missing command after --')
  }

  const cwd = opts.cwd ?? process.cwd()
  const [vitePort, cdpPort] = await pickFreePorts(2)

  // Spawn in a new process group so we can kill the whole tree by sending
  // a signal to -pgid. `detached: true` always; what changes between CLI
  // and library-callers is stdio + whether we unref + whether we forward
  // signals — see RunOptions.detach.
  const child = spawn(opts.argv[0]!, opts.argv.slice(1), {
    cwd,
    stdio: opts.detach ? 'ignore' : 'inherit',
    detached: true,
    env: {
      ...process.env,
      ...opts.env,
      CAM_VITE_PORT: String(vitePort),
      CAM_CDP_PORT: String(cdpPort),
      // Hint for the child / observers that they were spawned under camsys.
      CAM_SERVICE_NAME: opts.name,
    },
  })

  if (!child.pid) {
    throw new Error(`camsys run: failed to spawn ${opts.argv.join(' ')}`)
  }

  // On POSIX with detached:true, the child becomes the leader of a new
  // process group whose pgid equals child.pid.
  const pgid = child.pid

  // unref() lets the parent's event loop exit while the child keeps
  // running. CLI callers (`camsys run` in a terminal) DON'T want this —
  // they want the wrapper to wait for the child. Library callers in
  // fire-and-forget mode DO want it.
  if (opts.detach) child.unref()

  const entry: Entry = {
    name: opts.name,
    pid: child.pid,
    pgid,
    vitePort,
    cdpPort,
    cmd: opts.argv.join(' '),
    cwd,
    started: Date.now(),
  }
  writeEntry(entry)

  // Forward signals to the child's process group ONLY for the CLI path.
  // In detach mode (cam's main spawning docskit etc.) we don't want
  // cam's SIGTERM tearing down the spawned docskit window.
  if (!opts.detach) {
    let forwarding = false
    const forward = (signal: NodeJS.Signals) => {
      if (forwarding) return
      forwarding = true
      try { process.kill(-pgid, signal) } catch { /* group already gone */ }
    }
    for (const sig of FORWARDED_SIGNALS) {
      process.on(sig, () => forward(sig))
    }
  }

  // Wait for the child to exit; resolve with the exit code we should
  // propagate. The signal name (if any) is converted to a non-zero code
  // following the POSIX 128+N convention.
  const code = await new Promise<number>((resolve) => {
    child.on('exit', (exitCode, signal) => {
      if (signal) {
        resolve(128 + signalNumber(signal))
      } else {
        resolve(exitCode ?? 0)
      }
    })
    child.on('error', () => resolve(1))
  })

  // Always sweep our own registry entry.
  deleteEntry(opts.name)
  return code
}

/** POSIX signal name → integer. Falls back to 0 for unknown signals so
 *  the exit code stays well-defined. The named conversion isn't perfect
 *  across platforms; for CAM's use (everything is local dev) it's
 *  good enough. */
function signalNumber(sig: NodeJS.Signals | string): number {
  const map: Record<string, number> = {
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGABRT: 6, SIGKILL: 9,
    SIGTERM: 15, SIGSEGV: 11, SIGUSR1: 10, SIGUSR2: 12,
  }
  return map[sig] ?? 0
}
