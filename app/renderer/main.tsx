/**
 * camsys app renderer — mounts a single ServicesPanel as the whole UI.
 *
 * The IO adapter wraps window.camsysAPI (set by the preload script);
 * the panel itself comes from the public ui subpath we ship to other
 * hosts (cam, etc.). So this file is the canonical dogfood — if the
 * standalone app works, cam's embed works.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ServicesPanel, type ServicesIO } from '../../ui/ServicesPanel.js'
import './styles.css'

declare global {
  interface Window {
    camsysAPI?: {
      list(): Promise<unknown[]>
      kill(name: string): Promise<void>
    }
  }
}

const io: ServicesIO = {
  list: async () => {
    if (!window.camsysAPI) throw new Error('camsysAPI missing — Electron preload not loaded')
    return window.camsysAPI.list() as ReturnType<ServicesIO['list']>
  },
  kill: (name) => {
    if (!window.camsysAPI) throw new Error('camsysAPI missing — Electron preload not loaded')
    return window.camsysAPI.kill(name)
  },
}

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>camsys</h1>
        <p>Running services tracked at <code>~/.cam/run/</code></p>
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
