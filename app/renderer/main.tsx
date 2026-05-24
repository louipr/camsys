/**
 * camsys app renderer — mounts ServicesPanel as the whole UI.
 *
 * IO is HTTP `fetch` against the same origin (camsys's own daemon).
 * No preload, no `window.camsysAPI`, no contextBridge — the renderer
 * is just a web page that happens to be hosted by Electron's window
 * sometimes, and by cam's BrowserWindow other times (when cam
 * navigates to this app's daemon URL — see
 * `cam/docs/architecture/launched-apps.md`).
 *
 * When loaded inside cam (mobile-mode navigate-away), `document.referrer`
 * is cam's daemon (e.g. `http://localhost:5200/`). We surface a "Back
 * to cam" chip in that case so users have a one-click exit. When
 * loaded standalone (desktop-mode detached window), the referrer is
 * empty and the chip stays hidden.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BackToCam } from '../../ui/BackToCam.js'
import { ServicesPanel, type ServicesIO } from '../../ui/ServicesPanel.js'
// Component's own CSS (.camsys-* class catalog) — shipped with the
// ui subpath, dogfooded here.
import '../../ui/styles.css'
// App-shell chrome (.app-header, .app-shell). Local to this app.
import './styles.css'

const io: ServicesIO = {
  list: async () => {
    const r = await fetch('/api/services')
    if (!r.ok) throw new Error(`list failed: ${r.status}`)
    return r.json() as ReturnType<ServicesIO['list']>
  },
  kill: async (name) => {
    const r = await fetch('/api/services/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) throw new Error(`kill failed: ${r.status}`)
  },
}

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>camsys</h1>
        <p>Running services tracked at <code>~/.cam/run/</code></p>
        {/* Inline-in-header (override BackToCam's default fixed
            position). Same component the other CAM apps import via
            'camsys/ui'; here we reach it via the local source so
            dogfooding catches breaking changes immediately. */}
        <BackToCam style={{ position: 'static', display: 'inline-block', marginTop: 8 }} />
      </header>
      <main>
        <ServicesPanel io={io} refreshIntervalMs={2000} />
      </main>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root missing in index.html')
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
