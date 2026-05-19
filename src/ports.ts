/**
 * Free-port allocator.
 *
 * Asks the kernel for an ephemeral port via `bind(0)`, reads back the
 * port the kernel assigned, releases the socket, returns the port.
 *
 * There IS a tiny race window between releasing the socket and the
 * caller actually binding to that port — another process could grab
 * it. In practice this is a non-issue for CAM's use (the caller binds
 * immediately, and the ephemeral range is large enough that the kernel
 * is unlikely to re-issue the same port to a different bind() within
 * the window). Tools like Vitest/Playwright use the same pattern.
 *
 * If we ever need to harden this, we'd hold a "reserved" socket open
 * and pass it via SO_REUSEPORT — but that's a Linux-specific knob and
 * we've never seen the race trigger in practice.
 */

import { createServer } from 'node:net'

export async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        server.close()
        return reject(new Error('unexpected address shape from listen(0)'))
      }
      const port = addr.port
      server.close(() => resolve(port))
    })
  })
}

/** Pick N distinct free ports. The implementation just serializes pickFreePort
 *  N times — since each call returns a different port (kernel doesn't re-issue
 *  the same one to an immediately-reopened socket), distinctness is automatic. */
export async function pickFreePorts(n: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(await pickFreePort())
  return out
}
