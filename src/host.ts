/**
 * camsys host — the canonical HTTP shell every CAM-launched app
 * runs to serve its renderer + expose its API to the local browser
 * (and to cam in mobile mode).
 *
 * Pre-extraction, every CAM app (cam, audit, docskit, camsys's
 * own app, term) hand-rolled the same ~100 lines: createServer,
 * static file serve with SPA fallback, MIME table, vite dev
 * proxy, /cam-host/window-state endpoint. The variants — operation
 * dispatch shape, WebSocket vs SSE for push, per-app routes —
 * stay in each app. The mechanical scaffolding lives here.
 *
 * What this owns:
 *   - HTTP server lifecycle (port pick, bind, listen, close)
 *   - Static bundle serve with SPA fallback + MIME dispatch
 *   - Vite dev proxy (when running under electron-vite dev)
 *   - `/cam-host/window-state {action:'focus'|'minimize'}` — the
 *     launched-apps spec contract for cam-as-host
 *   - Optional `/api/events` SSE channel (when the caller wires
 *     a publisher via the returned `pushSse` helper)
 *   - Optional WebSocket upgrade on a caller-chosen path
 *
 * What the caller still owns:
 *   - Operation/API dispatch (per-app routes go through `onRequest`
 *     which runs BEFORE static/proxy fallback)
 *   - Push channel shape (use the SSE helper, attach WebSocket
 *     handlers, or roll your own — host doesn't dictate)
 *   - Domain logic
 *
 * Bind host defaults to 127.0.0.1 — local-only is the right default
 * for an app's daemon. cam overrides to '0.0.0.0' because it serves
 * the LAN browser + Cloudflare tunnel.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'
import { pickFreePort } from './ports.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** The subset of Electron's BrowserWindow that the window-state
 *  endpoint needs. Typed structurally so this file doesn't import
 *  Electron — keeps camsys consumable from non-Electron contexts. */
export interface HostWindow {
  focus(): void
  show(): void
  minimize(): void
  restore(): void
  isMinimized(): boolean
}

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
) => boolean | Promise<boolean>

export interface HostConfig {
  /** Where the renderer comes from. Provide `viteDevUrl` when
   *  running under electron-vite dev (the dev server URL on
   *  `process.env.ELECTRON_RENDERER_URL`), or `bundleDir` for the
   *  built static bundle (`out/renderer/` typically). Providing
   *  both is a misconfiguration — viteDevUrl wins. */
  renderer: { viteDevUrl: string } | { bundleDir: string } | { viteDevUrl?: string; bundleDir: string }

  /** Port to bind. Default: a free port via `pickFreePort()`. Pass
   *  a fixed port when your app has a stable contract (cam uses
   *  5200 so the Cloudflare tunnel config stays valid). */
  port?: number

  /** Bind host. Default '127.0.0.1' (local-only). Pass '0.0.0.0' to
   *  expose on the LAN. */
  bindHost?: string

  /** Optional BrowserWindow for `/cam-host/window-state` to act
   *  on. Omit if your app doesn't have a window (e.g. a headless
   *  service) or doesn't want the endpoint. */
  win?: HostWindow

  /** Per-app HTTP handler. Runs BEFORE the static/proxy fallback.
   *  Return true if the handler responded; return false to fall
   *  through to static/proxy. Async OK. */
  onRequest?: RequestHandler

  /** Optional WebSocket upgrade. The host creates a WebSocketServer
   *  on `path`; each new connection calls `onConnection`. */
  webSocket?: {
    path: string
    onConnection: (ws: WsWebSocket, req: IncomingMessage) => void
  }

  /** Optional log prefix for the listen line. Default: `[host]`. */
  logPrefix?: string

  /** Set true to register a default `GET /api/events` SSE channel.
   *  The returned `pushSse` helper writes to every connected client.
   *  Without this, /api/events 404s and pushSse is a no-op. */
  sse?: boolean
}

export interface HostHandle {
  /** Full URL the host is bound at (e.g. `http://localhost:5234/`). */
  url: string
  /** Push a named SSE event to every /api/events subscriber. No-op
   *  when `sse: false` (the default) or no clients are connected. */
  pushSse: (event: string, payload: unknown) => void
  /** Stop accepting connections + close any open WS / SSE clients. */
  close: () => Promise<void>
}

export async function startHost(config: HostConfig): Promise<HostHandle> {
  const port = config.port ?? (await pickFreePort())
  const bindHost = config.bindHost ?? '127.0.0.1'
  const logPrefix = config.logPrefix ?? '[host]'

  const viteDevUrl = 'viteDevUrl' in config.renderer ? config.renderer.viteDevUrl : undefined
  const bundleDir = 'bundleDir' in config.renderer ? config.renderer.bundleDir : undefined
  if (!viteDevUrl && !bundleDir) {
    throw new Error('startHost: renderer requires viteDevUrl or bundleDir')
  }

  const sseClients = new Set<ServerResponse>()

  const server: HttpServer = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    // 1. /cam-host/window-state — spec contract for cam-as-host.
    if (config.win && url === '/cam-host/window-state' && req.method === 'POST') {
      void handleWindowState(req, res, config.win)
      return
    }

    // 2. /api/events — SSE channel (opt-in via config.sse).
    if (config.sse && url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      req.on('close', () => { sseClients.delete(res) })
      return
    }

    // 3. Per-app handler (opt-in). May respond async; result decides
    //    whether to fall through to static/proxy.
    const onReq = config.onRequest
    if (onReq) {
      Promise.resolve(onReq(req, res, url)).then((handled) => {
        if (handled) return
        if (viteDevUrl) handleDevProxy(viteDevUrl, req, res)
        else if (bundleDir) handleStatic(bundleDir, req, res)
        else { res.writeHead(404); res.end('Not found') }
      }).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
      return
    }

    if (viteDevUrl) handleDevProxy(viteDevUrl, req, res)
    else if (bundleDir) handleStatic(bundleDir, req, res)
    else { res.writeHead(404); res.end('Not found') }
  })

  let wss: WebSocketServer | null = null
  if (config.webSocket) {
    wss = new WebSocketServer({ server, path: config.webSocket.path })
    wss.on('connection', config.webSocket.onConnection)
  }

  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, () => {
      // eslint-disable-next-line no-console
      console.log(`${logPrefix} listening on http://${bindHost === '0.0.0.0' ? '0.0.0.0' : 'localhost'}:${port}/`)
      resolve()
    })
  })

  const pushSse = (event: string, payload: unknown): void => {
    if (sseClients.size === 0) return
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(frame) } catch { /* dropped */ }
    }
  }

  const close = async (): Promise<void> => {
    for (const res of sseClients) { try { res.end() } catch { /* */ } }
    sseClients.clear()
    if (wss) await new Promise<void>((r) => wss!.close(() => r()))
    await new Promise<void>((r) => server.close(() => r()))
  }

  const displayHost = bindHost === '0.0.0.0' ? 'localhost' : bindHost
  return {
    url: `http://${displayHost}:${port}/`,
    pushSse,
    close,
  }
}

// ── Static file serving (prod) ─────────────────────────────────────

function handleStatic(bundleDir: string, req: IncomingMessage, res: ServerResponse): void {
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/'
  // Normalize + strip "../" escapes so a remote can't pull files
  // outside the bundle directory.
  const rel = normalize(urlPath === '/' ? 'index.html' : urlPath).replace(/^[/\\]+/, '')
  const abs = join(bundleDir, rel)
  if (!abs.startsWith(bundleDir) || !existsSync(abs) || !statSync(abs).isFile()) {
    // SPA fallback — unknown routes serve index.html so client-side
    // navigation works.
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

// ── Vite dev proxy ─────────────────────────────────────────────────

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
    res.end(`Vite dev proxy failed: ${String(e)}`)
  })
}

// ── /cam-host/window-state ─────────────────────────────────────────

async function handleWindowState(
  req: IncomingMessage,
  res: ServerResponse,
  win: HostWindow,
): Promise<void> {
  try {
    const body = await readJsonBody(req) as { action?: string } | null
    const action = body?.action
    if (action !== 'focus' && action !== 'minimize') {
      jsonResponse(res, 400, { error: 'action must be focus|minimize' })
      return
    }
    if (action === 'focus') {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else {
      win.minimize()
    }
    jsonResponse(res, 200, { ok: true })
  } catch (e) {
    jsonResponse(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
}

// ── Shared HTTP helpers (exported so per-app handlers can reuse) ──

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
