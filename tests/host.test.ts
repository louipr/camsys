/**
 * host smoke tests — exercise the actual HTTP shell end-to-end
 * with real sockets. Keep these tight: spin up the host, hit it
 * over fetch, verify the contract holds.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHost } from '../src/host.js'

function makeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'camsys-host-'))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html><html>OK</html>')
  writeFileSync(join(dir, 'app.js'), 'console.log("hi")')
  return dir
}

describe('startHost', () => {
  it('serves bundled index.html at /', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      const r = await fetch(host.url)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain('text/html')
      expect(await r.text()).toContain('OK')
    } finally {
      await host.close()
    }
  })

  it('falls back to index.html for unknown routes (SPA)', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      const r = await fetch(`${host.url}some/deep/route`)
      expect(r.status).toBe(200)
      expect(await r.text()).toContain('OK')
    } finally {
      await host.close()
    }
  })

  it('serves static files with correct MIME', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      const r = await fetch(`${host.url}app.js`)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain('text/javascript')
    } finally {
      await host.close()
    }
  })

  it('refuses to escape the bundle directory', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      // ../ in the URL should NOT pull files outside bundleDir — it
      // should fall through to the SPA fallback.
      const r = await fetch(`${host.url}../../../etc/passwd`)
      expect(r.status).toBe(200)
      expect(await r.text()).toContain('OK')
    } finally {
      await host.close()
    }
  })

  it('runs the onRequest hook BEFORE static fallback', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({
      renderer: { bundleDir },
      onRequest: (_req, res, url) => {
        if (url === '/api/hello') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return true
        }
        return false
      },
    })
    try {
      const hit = await fetch(`${host.url}api/hello`)
      expect(hit.status).toBe(200)
      expect(await hit.json()).toEqual({ ok: true })

      // Non-matching path falls through to SPA.
      const miss = await fetch(`${host.url}api/nope`)
      expect(miss.status).toBe(200)
      expect(await miss.text()).toContain('OK')
    } finally {
      await host.close()
    }
  })

  it('handles /cam-host/window-state when win is provided', async () => {
    const bundleDir = makeBundle()
    const calls: string[] = []
    const win = {
      focus: () => calls.push('focus'),
      show: () => calls.push('show'),
      minimize: () => calls.push('minimize'),
      restore: () => calls.push('restore'),
      isMinimized: () => false,
    }
    const host = await startHost({ renderer: { bundleDir }, win })
    try {
      const focusRes = await fetch(`${host.url}cam-host/window-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'focus' }),
      })
      expect(focusRes.status).toBe(200)
      expect(calls).toEqual(['show', 'focus'])

      calls.length = 0
      const minRes = await fetch(`${host.url}cam-host/window-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'minimize' }),
      })
      expect(minRes.status).toBe(200)
      expect(calls).toEqual(['minimize'])
    } finally {
      await host.close()
    }
  })

  it('skips /cam-host/window-state when no win passed', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      // No win → endpoint not registered → falls through to SPA.
      const r = await fetch(`${host.url}cam-host/window-state`, {
        method: 'POST',
        body: JSON.stringify({ action: 'focus' }),
      })
      expect(r.status).toBe(200) // SPA fallback returns index.html
    } finally {
      await host.close()
    }
  })

  it('pushSse is a no-op when sse is disabled', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir } })
    try {
      // Doesn't throw, doesn't do anything.
      host.pushSse('test', { hello: 'world' })

      // /api/events is not registered → SPA fallback.
      const r = await fetch(`${host.url}api/events`)
      expect(r.status).toBe(200)
      expect(await r.text()).toContain('OK')
    } finally {
      await host.close()
    }
  })

  it('delivers SSE events when sse is enabled', async () => {
    const bundleDir = makeBundle()
    const host = await startHost({ renderer: { bundleDir }, sse: true })
    try {
      // Open SSE stream + collect first event frame.
      const res = await fetch(`${host.url}api/events`)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const reader = res.body!.getReader()

      // Read the initial `: connected` chunk so the client is registered.
      const greeting = await reader.read()
      expect(new TextDecoder().decode(greeting.value)).toContain('connected')

      // Now push.
      host.pushSse('hello', { n: 42 })

      const chunk = await reader.read()
      const text = new TextDecoder().decode(chunk.value)
      expect(text).toContain('event: hello')
      expect(text).toContain('"n":42')

      await reader.cancel()
    } finally {
      await host.close()
    }
  })
})
