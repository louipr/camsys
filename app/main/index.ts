/**
 * camsys standalone Electron app — main process.
 *
 * Adopts the daemon-WS pattern documented in cam's
 * `docs/architecture/launched-apps.md`: instead of a preload + IPC
 * bridge, the main process stands up a local HTTP server, the
 * renderer loads from that origin via `loadURL`, and renderer ↔ main
 * traffic is HTTP `fetch`. Same shape cam uses for its own daemon —
 * the difference is camsys's surface is tiny (list / kill / window-
 * state) so REST is enough; no WebSocket needed.
 *
 * Why this matters: with the renderer reachable over HTTP, cam can
 * surface camsys's window inside cam's own BrowserWindow (mobile
 * mode "navigate-away") by setting `window.location.href` to the
 * daemon URL. The detached Electron window keeps working for
 * desktop mode; the same renderer bundle serves both.
 *
 * Lifecycle:
 *   1. Pick a free port via the kernel.
 *   2. Start HTTP server on that port serving the renderer +
 *      `/api/services`, `/api/services/kill`, `/cam-host/window-state`.
 *      In dev: proxy `/` and `/assets/*` to the electron-vite dev
 *      server at ELECTRON_RENDERER_URL.
 *   3. `updateEntryMeta(name, { url })` on the registry entry that
 *      `camsys run` already wrote on spawn — surface the daemon URL
 *      so cam's ProcessDock + (eventually) other consumers can use
 *      it. `name` comes from CAM_SERVICE_NAME (set by camsys run)
 *      and defaults to 'camsys:app' for standalone-electron launches.
 *   4. BrowserWindow loads `http://localhost:<port>/`. No preload —
 *      no Electron-injected globals are needed because everything
 *      flows over HTTP.
 *
 * The `/cam-host/window-state` endpoint is the contract from
 * cam's `focusService(name)` / `minimizeService(name)` library
 * primitives — POST `{action: 'focus' | 'minimize'}` and the launched
 * app signals its own BrowserWindow.
 */
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import {
  listEntries,
  killService,
  updateEntryMeta,
  writeEntry,
  deleteEntry,
  type Entry,
} from '../../src/registry.js'
import { pickFreePort } from '../../src/ports.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
}

let win: BrowserWindow | null = null

function createWindow(daemonUrl: string): BrowserWindow {
  const w = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'camsys — running services',
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  void w.loadURL(daemonUrl)
  return w
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) return resolve(null)
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): boolean {
  // GET /api/services  → Entry[]
  if (url === '/api/services' && req.method === 'GET') {
    jsonResponse(res, 200, listEntries())
    return true
  }
  // POST /api/services/kill { name }
  if (url === '/api/services/kill' && req.method === 'POST') {
    void readJsonBody(req).then((body) => {
      const name = (body as { name?: string } | null)?.name
      if (typeof name !== 'string') return jsonResponse(res, 400, { error: 'name required' })
      killService(name)
      jsonResponse(res, 200, { ok: true })
    }).catch((e) => jsonResponse(res, 400, { error: String(e) }))
    return true
  }
  // POST /cam-host/window-state { action }
  // Called by cam's focusService / minimizeService primitives.
  if (url === '/cam-host/window-state' && req.method === 'POST') {
    void readJsonBody(req).then((body) => {
      const action = (body as { action?: string } | null)?.action
      if (action !== 'focus' && action !== 'minimize') {
        return jsonResponse(res, 400, { error: 'action must be focus|minimize' })
      }
      if (!win) return jsonResponse(res, 503, { error: 'no window' })
      if (action === 'focus') {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      } else {
        win.minimize()
      }
      jsonResponse(res, 200, { ok: true })
    }).catch((e) => jsonResponse(res, 400, { error: String(e) }))
    return true
  }
  return false
}

function handleStatic(bundleDir: string, req: IncomingMessage, res: ServerResponse): void {
  const urlPath = (req.url ?? '/').split('?')[0]!
  const rel = normalize(urlPath === '/' ? 'index.html' : urlPath).replace(/^[/\\]+/, '')
  const abs = join(bundleDir, rel)
  if (!abs.startsWith(bundleDir) || !existsSync(abs) || !statSync(abs).isFile()) {
    const fallback = join(bundleDir, 'index.html')
    if (existsSync(fallback)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      createReadStream(fallback).pipe(res)
      return
    }
    res.writeHead(404)
    res.end('Not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' })
  createReadStream(abs).pipe(res)
}

function handleDevProxy(viteDevUrl: string, req: IncomingMessage, res: ServerResponse): void {
  const target = new URL(req.url ?? '/', viteDevUrl)
  fetch(target.toString(), {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
  }).then(async (r) => {
    const hdrs: Record<string, string> = {}
    r.headers.forEach((v, k) => { hdrs[k] = v })
    res.writeHead(r.status, hdrs)
    if (r.body) {
      const reader = r.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  }).catch((e) => {
    res.writeHead(502)
    res.end(`vite dev proxy failed: ${String(e)}`)
  })
}

async function startDaemon(): Promise<string> {
  const port = await pickFreePort()
  const viteDevUrl = process.env.ELECTRON_RENDERER_URL
  const bundleDir = join(__dirname, '../renderer')

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!
    if (handleApi(req, res, url)) return
    if (viteDevUrl) handleDevProxy(viteDevUrl, req, res)
    else handleStatic(bundleDir, req, res)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`
      // eslint-disable-next-line no-console
      console.log(`[camsys-app] listening on ${url}`)
      resolve(url)
    })
  })
}

app.whenReady().then(async () => {
  const daemonUrl = await startDaemon()

  // Make sure the registry has an entry for us, then advertise the
  // daemon URL on it. Two launch paths to support:
  //   1. `camsys run` / `cam.camsys.openApp()` — entry already exists
  //      (camsys run wrote it on spawn). updateEntryMeta merges url in.
  //   2. `electron-vite dev` (e.g. cam tile's "dev" script, or a dev
  //      running camsys directly) — no upstream wrapper, no entry.
  //      updateEntryMeta returns false; we writeEntry a fresh one.
  // Name comes from CAM_SERVICE_NAME (set by camsys run) and falls
  // back to 'camsys:app' for standalone launches.
  const name = process.env.CAM_SERVICE_NAME ?? 'camsys:app'
  if (!updateEntryMeta(name, { url: daemonUrl })) {
    writeEntry({
      name,
      pid: process.pid,
      pgid: process.pid,
      cmd: process.argv.join(' '),
      cwd: process.cwd(),
      started: Date.now(),
      meta: { url: daemonUrl },
    })
    // We self-registered, so we own teardown of our own entry too.
    // The wrapped-by-camsys-run path already has its own cleanup.
    app.on('will-quit', () => { deleteEntry(name) })
  }

  if (!win) win = createWindow(daemonUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(daemonUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Re-export Entry shape so the type is reachable from the renderer
// build via the renderer's own type imports. (No runtime dep — the
// renderer fetches over HTTP.)
export type { Entry }
