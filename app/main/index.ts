/**
 * camsys standalone Electron app — main process.
 *
 * Adopts the daemon-WS pattern documented in cam's
 * `docs/architecture/launched-apps.md` via the shared
 * `startHost` from camsys's library face: HTTP serves the
 * renderer (vite proxy in dev, static in prod), per-app routes
 * (`/api/services`, `/api/services/kill`) hook in via
 * onRequest, and `/cam-host/window-state` falls through to
 * the host's built-in handler when we pass `win`.
 *
 * Lifecycle:
 *   1. startHost() picks a free port + binds the server.
 *   2. `updateEntryMeta(name, { url })` advertises the daemon
 *      URL on the registry entry `camsys run` already wrote
 *      so cam can route into it (mobile-mode navigate-away).
 *   3. BrowserWindow loads `http://localhost:<port>/`. No
 *      preload — everything flows over HTTP.
 *
 * Mobile-mode subtlety: if cam launched us with
 * CAM_HOST_MODE=mobile, cam navigates ITS OWN BrowserWindow
 * into our daemon URL — we stay headless. A later
 * `POST /cam-host/window-state {action:'focus'}` materializes
 * our window (user flipped cam to desktop after launch). The
 * library's window handler only acts on a passed-in `win`;
 * we pass a thin shim that lazy-creates the window on focus.
 */
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  listEntries,
  killService,
  updateEntryMeta,
  type Entry,
} from '../../src/registry.js'
import { startHost, readJsonBody, jsonResponse, type HostWindow } from '../../src/host.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let win: BrowserWindow | null = null
let currentDaemonUrl = ''

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

/** Lazy window proxy for the host's /cam-host/window-state
 *  handler. focus() materializes the window if it doesn't
 *  exist (handles the mobile→desktop flip after launch). */
const lazyWin: HostWindow = {
  focus: () => {
    if (!win) win = createWindow(currentDaemonUrl)
    win.focus()
  },
  show: () => {
    if (!win) win = createWindow(currentDaemonUrl)
    win.show()
  },
  minimize: () => { if (win) win.minimize() },
  restore: () => { win?.restore() },
  isMinimized: () => win?.isMinimized() ?? false,
}

app.whenReady().then(async () => {
  const host = await startHost({
    renderer: process.env.ELECTRON_RENDERER_URL
      ? { viteDevUrl: process.env.ELECTRON_RENDERER_URL }
      : { bundleDir: join(__dirname, '../renderer') },
    win: lazyWin,
    logPrefix: '[camsys-app]',
    onRequest: async (req, res, url) => {
      if (url === '/api/services' && req.method === 'GET') {
        jsonResponse(res, 200, listEntries())
        return true
      }
      if (url === '/api/services/kill' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req) as { name?: string } | null
          if (typeof body?.name !== 'string') {
            jsonResponse(res, 400, { error: 'name required' })
            return true
          }
          killService(body.name)
          jsonResponse(res, 200, { ok: true })
        } catch (e) {
          jsonResponse(res, 400, { error: String(e) })
        }
        return true
      }
      return false
    },
  })
  currentDaemonUrl = host.url

  // The app is always launched under `camsys run`; the wrapper
  // already wrote the registry entry on spawn — merge our
  // daemon URL in so cam can route to it.
  const name = process.env.CAM_SERVICE_NAME ?? 'camsys:app'
  if (!updateEntryMeta(name, { url: host.url })) {
    // eslint-disable-next-line no-console
    console.warn(
      `[camsys-app] no registry entry for '${name}'. ` +
      `This Electron main must be launched via 'camsys run' ` +
      `(see package.json scripts). ProcessDock won't track this window.`,
    )
  }

  // Stay headless when cam launched us in mobile mode — cam
  // navigates its own BrowserWindow to our daemon URL.
  const headless = process.env.CAM_HOST_MODE === 'mobile'
  if (!headless && !win) win = createWindow(host.url)

  app.on('activate', () => {
    if (headless) return
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(host.url)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Re-export Entry shape so the type is reachable from the renderer
// build via the renderer's own type imports. (No runtime dep — the
// renderer fetches over HTTP.)
export type { Entry }
