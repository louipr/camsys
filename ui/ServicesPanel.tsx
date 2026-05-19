/**
 * ServicesPanel — live view of the camsys registry.
 *
 * Renders entries from ~/.cam/run/ as a table with name, pid, ports,
 * age, alive-indicator, and a Kill button per row. Polls via the
 * host-provided `io.list()` on an interval; user actions fire callbacks
 * back to the host (`io.kill(name)`, `onOpenService(name)`).
 *
 * Host I/O is inverted (same pattern as docskit's createEditor):
 * the component knows nothing about Electron IPC, filesystem,
 * permissions, or kill semantics. The host implements them. This
 * keeps the component renderable in any React host — Electron
 * renderer, web app over a localhost HTTP endpoint, Storybook with
 * a mock IO, etc.
 *
 * Styles: class-name-based with no inline overrides. Hosts style via
 * their own CSS (`.camsys-panel`, `.camsys-row`, etc.) — see README
 * for the class catalog. No CSS-in-JS dep, no theme dependency.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Entry } from '../src/registry.js'

export type { Entry }

export interface ServicesIO {
  /** Read the current registry. Called on mount + every refresh tick. */
  list(): Promise<Entry[]>
  /** Send SIGTERM to a service's process group + drop its registry entry. */
  kill(name: string): Promise<void>
}

export interface ServicesPanelProps {
  io: ServicesIO
  /** Poll interval in ms. 0 disables auto-refresh. Default: 2000. */
  refreshIntervalMs?: number
  /** Optional row-click handler — hosts wire this to in-app navigation
   *  (e.g., cam routes to that service's PackageDetailPage). */
  onOpenService?(name: string): void
}

export function ServicesPanel({
  io,
  refreshIntervalMs = 2000,
  onOpenService,
}: ServicesPanelProps) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingKill, setPendingKill] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await io.list()
      setEntries(next)
      setError(null)
    } catch (err) {
      setError((err as Error).message ?? String(err))
    }
  }, [io])

  // Initial load + interval. Cleanup clears the interval on unmount or
  // io-identity change.
  useEffect(() => {
    void refresh()
    if (refreshIntervalMs <= 0) return
    const id = setInterval(() => void refresh(), refreshIntervalMs)
    return () => clearInterval(id)
  }, [refresh, refreshIntervalMs])

  const handleKill = useCallback(
    async (name: string) => {
      setPendingKill(name)
      try {
        await io.kill(name)
        await refresh()
      } catch (err) {
        setError(`kill ${name}: ${(err as Error).message ?? String(err)}`)
      } finally {
        setPendingKill(null)
      }
    },
    [io, refresh],
  )

  if (entries === null && error === null) {
    return <div className="camsys-panel camsys-panel-loading">Loading…</div>
  }

  return (
    <div className="camsys-panel">
      {error && (
        <div className="camsys-error" role="alert">
          {error}
        </div>
      )}

      {entries && entries.length === 0 ? (
        <div className="camsys-empty">No services registered</div>
      ) : (
        <table className="camsys-table">
          <thead>
            <tr>
              <th className="camsys-col-name">Name</th>
              <th className="camsys-col-pid">PID</th>
              <th className="camsys-col-port">Vite</th>
              <th className="camsys-col-port">CDP</th>
              <th className="camsys-col-age">Age</th>
              <th className="camsys-col-action" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => (
              <tr key={e.name} className="camsys-row">
                <td>
                  {onOpenService ? (
                    <button
                      type="button"
                      className="camsys-row-link"
                      onClick={() => onOpenService(e.name)}
                      title={e.cmd}
                    >
                      {e.name}
                    </button>
                  ) : (
                    <span title={e.cmd}>{e.name}</span>
                  )}
                </td>
                <td className="camsys-mono">{e.pid}</td>
                <td className="camsys-mono">{e.vitePort ?? '—'}</td>
                <td className="camsys-mono">{e.cdpPort ?? '—'}</td>
                <td>{formatAge(Date.now() - e.started)}</td>
                <td className="camsys-col-action">
                  <button
                    type="button"
                    className="camsys-kill"
                    onClick={() => handleKill(e.name)}
                    disabled={pendingKill === e.name}
                    aria-label={`Kill ${e.name}`}
                    title={`SIGTERM the process group (pgid=${e.pgid})`}
                  >
                    {pendingKill === e.name ? '…' : 'Kill'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}
